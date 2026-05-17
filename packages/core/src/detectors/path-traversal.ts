/**
 * Path Traversal Sink Detector
 *
 * Detects tainted paths in filesystem operations:
 * - fs.readFile(taintedPath, ...)
 * - fs.writeFile(taintedPath, ...)
 * - fs.createReadStream(taintedPath)
 * - fs.unlink(taintedPath)
 * - etc.
 *
 * Safe when:
 * - Path is sanitized with path.basename() before fs operation
 * - Path is a literal string (not user-supplied)
 * - Path is from a trusted source (config, allowlist, etc.)
 *
 * This is taint analysis — traces user input to filesystem sink.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Sink, TaintedSource } from '../ir/types';

/**
 * Detects path traversal sinks in a handler function body.
 *
 * @param handlerNode - The route handler function
 * @param taintedSources - User-supplied tainted sources from the handler
 * @returns Array of Sink nodes with kind 'fs-path'
 */
export function detectPathTraversalSinks(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  taintedSources: TaintedSource[]
): Sink[] {
  const sinks: Sink[] = [];

  // Handler body must be a block statement
  if (handlerNode.body.type !== 'BlockStatement') return sinks;

  // Track variables that have been sanitized with path.basename()
  const sanitizedVars = new Set<string>();
  
  // First pass: identify sanitized variables
  walkStatements(handlerNode.body.body, (node) => {
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (decl.id.type === 'Identifier' && decl.init) {
          if (isPathBasenameCall(decl.init)) {
            sanitizedVars.add(decl.id.name);
          }
        }
      }
    }
  });

  // Second pass: detect fs operations with tainted paths
  walkStatements(handlerNode.body.body, (node) => {
    if (node.type === 'CallExpression') {
      const sink = detectFileSystemCall(node, taintedSources, sanitizedVars);
      if (sink) sinks.push(sink);
    }
  });

  return sinks;
}

/**
 * Detects if a CallExpression is a filesystem operation with tainted path.
 *
 * Matches:
 * - fs.readFile(taintedPath, ...)
 * - fs.writeFile(taintedPath, ...)
 * - fs.createReadStream(taintedPath)
 * - fs.unlink(taintedPath)
 * - etc.
 *
 * Does NOT match:
 * - fs.readFile('/hardcoded/path', ...)
 * - fs.readFile(path.basename(taintedPath), ...)
 * - other.readFile() where object is not fs
 */
function detectFileSystemCall(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[],
  sanitizedVars: Set<string>
): Sink | null {
  // Must be: fs.method(...)
  if (node.callee.type !== 'MemberExpression') return null;
  if (node.callee.object.type !== 'Identifier') return null;
  if (node.callee.property.type !== 'Identifier') return null;

  const objName = node.callee.object.name;
  const methodName = node.callee.property.name;

  // Must be fs.* operation
  if (objName !== 'fs') return null;

  // Check if this is a filesystem operation we care about
  const fsOperations = [
    'readFile', 'readFileSync',
    'writeFile', 'writeFileSync',
    'appendFile', 'appendFileSync',
    'createReadStream', 'createWriteStream',
    'unlink', 'unlinkSync',
    'rmdir', 'rmdirSync',
    'mkdir', 'mkdirSync',
    'readdir', 'readdirSync',
    'stat', 'statSync',
    'access', 'accessSync',
    'open', 'openSync',
    'chmod', 'chmodSync',
    'chown', 'chownSync',
  ];

  if (!fsOperations.includes(methodName)) return null;

  // Get the path argument (always first argument for these operations)
  if (node.arguments.length === 0) return null;
  const pathArg = node.arguments[0];

  // Find taint in the path argument
  const taintInfo = findTaintInPath(pathArg, taintedSources, sanitizedVars);
  if (!taintInfo) return null;

  // Check if the tainted input is sanitized
  if (isSanitized(taintInfo.taintedNode, sanitizedVars)) {
    return null; // Safe — sanitized with path.basename()
  }

  // Vulnerable — tainted and not sanitized
  return {
    kind: 'fs-path',
    node: node,
    taintedArg: {
      argIndex: 0,
      taintSource: taintInfo.taintSource,
      node: taintInfo.taintedNode,
    },
  };
}

/**
 * Finds tainted input within a path argument.
 *
 * Handles:
 * - Template literals: `./uploads/${req.params.filename}`
 * - String concatenation: './uploads/' + req.params.filename
 * - path.join() calls: path.join('./uploads', req.query.file)
 * - Direct tainted values: req.params.filename
 *
 * @returns Taint info if found, null if path is safe
 */
function findTaintInPath(
  pathArg: TSESTree.Node,
  taintedSources: TaintedSource[],
  sanitizedVars: Set<string>
): { taintedNode: TSESTree.Node; taintSource: TaintedSource } | null {
  
  // Pattern 1: Template literal with tainted expression
  // `./uploads/${req.params.filename}`
  if (pathArg.type === 'TemplateLiteral') {
    for (const expr of pathArg.expressions) {
      const taint = traceTaint(expr, taintedSources);
      if (taint && !isSanitized(expr, sanitizedVars)) {
        return { taintedNode: expr, taintSource: taint };
      }
    }
  }

  // Pattern 2: String concatenation
  // './uploads/' + req.params.filename
  if (pathArg.type === 'BinaryExpression' && pathArg.operator === '+') {
    const leftTaint = traceTaint(pathArg.left, taintedSources);
    if (leftTaint && !isSanitized(pathArg.left, sanitizedVars)) {
      return { taintedNode: pathArg.left, taintSource: leftTaint };
    }

    const rightTaint = traceTaint(pathArg.right, taintedSources);
    if (rightTaint && !isSanitized(pathArg.right, sanitizedVars)) {
      return { taintedNode: pathArg.right, taintSource: rightTaint };
    }
  }

  // Pattern 3: path.join() with tainted argument
  // path.join('./uploads', req.query.file)
  if (pathArg.type === 'CallExpression' && isPathJoinCall(pathArg)) {
    for (const arg of pathArg.arguments) {
      const taint = traceTaint(arg, taintedSources);
      if (taint && !isSanitized(arg, sanitizedVars)) {
        return { taintedNode: arg, taintSource: taint };
      }
    }
  }

  // Pattern 4: Direct tainted identifier or member expression
  const taint = traceTaint(pathArg, taintedSources);
  if (taint && !isSanitized(pathArg, sanitizedVars)) {
    return { taintedNode: pathArg, taintSource: taint };
  }

  return null;
}

/**
 * Checks if a node is sanitized with path.basename().
 *
 * Returns true for:
 * - path.basename(taintedValue) — direct wrapper
 * - sanitizedVar — where sanitizedVar = path.basename(taintedValue)
 *
 * @param node - The node to check
 * @param sanitizedVars - Set of variable names that have been sanitized
 * @returns true if sanitized, false otherwise
 */
function isSanitized(node: TSESTree.Node, sanitizedVars: Set<string>): boolean {
  // Pattern 1: Direct path.basename() wrapper
  if (isPathBasenameCall(node)) {
    return true;
  }

  // Pattern 2: Identifier that references a sanitized variable
  if (node.type === 'Identifier') {
    return sanitizedVars.has(node.name);
  }

  return false;
}

/**
 * Checks if a node is a path.basename() call.
 *
 * Matches: path.basename(...)
 */
function isPathBasenameCall(node: TSESTree.Node): boolean {
  if (node.type !== 'CallExpression') return false;
  if (node.callee.type !== 'MemberExpression') return false;
  if (node.callee.object.type !== 'Identifier') return false;
  if (node.callee.property.type !== 'Identifier') return false;

  return (
    node.callee.object.name === 'path' &&
    node.callee.property.name === 'basename'
  );
}

/**
 * Checks if a node is a path.join() call.
 *
 * Matches: path.join(...)
 */
function isPathJoinCall(node: TSESTree.CallExpression): boolean {
  if (node.callee.type !== 'MemberExpression') return false;
  if (node.callee.object.type !== 'Identifier') return false;
  if (node.callee.property.type !== 'Identifier') return false;

  return (
    node.callee.object.name === 'path' &&
    node.callee.property.name === 'join'
  );
}

/**
 * Traces a node back to a tainted source.
 *
 * Handles:
 * - Direct identifier reference: `filename` → traces to `const filename = req.params.filename`
 * - Member expression: `req.params.filename` → matches tainted source directly
 *
 * @param node - The node to trace
 * @param taintedSources - Known tainted sources in the handler
 * @returns The tainted source if found, null otherwise
 */
function traceTaint(
  node: TSESTree.Node,
  taintedSources: TaintedSource[]
): TaintedSource | null {
  // Pattern 1: Direct identifier reference
  if (node.type === 'Identifier') {
    const varName = node.name;
    return taintedSources.find((src) => src.localName === varName) || null;
  }

  // Pattern 2: Direct member expression
  if (node.type === 'MemberExpression') {
    for (const source of taintedSources) {
      if (matchesTaintedMemberExpression(node, source)) {
        return source;
      }
    }
  }

  // Pattern 3: CallExpression result (e.g., path.join() with tainted args)
  // Already handled by findTaintInPath for path.join specifically

  return null;
}

/**
 * Checks if a MemberExpression matches a tainted source pattern.
 *
 * Example:
 * - MemberExpression: req.params.filename
 * - TaintedSource: { localName: 'filename', requestKey: 'filename', kind: 'route-param' }
 * - Match: true (both refer to req.params.filename)
 */
function matchesTaintedMemberExpression(
  node: TSESTree.MemberExpression,
  source: TaintedSource
): boolean {
  // Check if the property name matches the request key
  if (node.property.type === 'Identifier') {
    return node.property.name === source.requestKey;
  }

  return false;
}

/**
 * Recursively walks statements and calls visitor for each node.
 *
 * @param statements - Array of statements to walk
 * @param visitor - Function to call for each node
 */
function walkStatements(
  statements: TSESTree.Statement[],
  visitor: (node: TSESTree.Node) => void
): void {
  for (const stmt of statements) {
    walkNode(stmt, visitor);
  }
}

/**
 * Recursively walks a single node and calls visitor.
 *
 * @param node - Current AST node
 * @param visitor - Function to call for each node
 */
function walkNode(node: TSESTree.Node, visitor: (node: TSESTree.Node) => void): void {
  visitor(node);

  // Recursively visit child nodes based on node type
  switch (node.type) {
    case 'ExpressionStatement':
      walkNode(node.expression, visitor);
      break;

    case 'VariableDeclaration':
      for (const decl of node.declarations) {
        if (decl.init) walkNode(decl.init, visitor);
      }
      break;

    case 'IfStatement':
      walkNode(node.test, visitor);
      walkNode(node.consequent, visitor);
      if (node.alternate) walkNode(node.alternate, visitor);
      break;

    case 'BlockStatement':
      walkStatements(node.body, visitor);
      break;

    case 'ReturnStatement':
      if (node.argument) walkNode(node.argument, visitor);
      break;

    case 'CallExpression':
      for (const arg of node.arguments) {
        walkNode(arg, visitor);
      }
      break;

    case 'MemberExpression':
      walkNode(node.object, visitor);
      if (node.property.type !== 'Literal') {
        walkNode(node.property, visitor);
      }
      break;

    case 'BinaryExpression':
    case 'LogicalExpression':
      walkNode(node.left, visitor);
      walkNode(node.right, visitor);
      break;

    case 'ConditionalExpression':
      walkNode(node.test, visitor);
      walkNode(node.consequent, visitor);
      walkNode(node.alternate, visitor);
      break;

    case 'ArrayExpression':
      for (const elem of node.elements) {
        if (elem) walkNode(elem, visitor);
      }
      break;

    case 'ObjectExpression':
      for (const prop of node.properties) {
        if (prop.type === 'Property') {
          walkNode(prop.value, visitor);
        }
      }
      break;

    case 'TemplateLiteral':
      for (const expr of node.expressions) {
        walkNode(expr, visitor);
      }
      break;

    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      if (node.body.type === 'BlockStatement') {
        walkStatements(node.body.body, visitor);
      } else {
        walkNode(node.body, visitor);
      }
      break;

    case 'TryStatement':
      walkNode(node.block, visitor);
      if (node.handler) walkNode(node.handler.body, visitor);
      if (node.finalizer) walkNode(node.finalizer, visitor);
      break;

    case 'ForStatement':
      if (node.init) walkNode(node.init, visitor);
      if (node.test) walkNode(node.test, visitor);
      if (node.update) walkNode(node.update, visitor);
      walkNode(node.body, visitor);
      break;

    case 'WhileStatement':
    case 'DoWhileStatement':
      walkNode(node.test, visitor);
      walkNode(node.body, visitor);
      break;

    case 'ForInStatement':
    case 'ForOfStatement':
      walkNode(node.left, visitor);
      walkNode(node.right, visitor);
      walkNode(node.body, visitor);
      break;

    case 'SwitchStatement':
      walkNode(node.discriminant, visitor);
      for (const caseNode of node.cases) {
        for (const stmt of caseNode.consequent) {
          walkNode(stmt, visitor);
        }
      }
      break;

    // Leaf nodes or nodes we don't need to traverse
    case 'Identifier':
    case 'Literal':
    case 'ThisExpression':
    case 'BreakStatement':
    case 'ContinueStatement':
      break;

    default:
      // For any unhandled node types, attempt generic traversal
      for (const key in node) {
        if (key === 'parent' || key === 'loc' || key === 'range') continue;

        const value = (node as any)[key];
        if (value && typeof value === 'object') {
          if (Array.isArray(value)) {
            for (const item of value) {
              if (item && typeof item === 'object' && item.type) {
                walkNode(item, visitor);
              }
            }
          } else if (value.type) {
            walkNode(value, visitor);
          }
        }
      }
  }
}

// Made with Bob