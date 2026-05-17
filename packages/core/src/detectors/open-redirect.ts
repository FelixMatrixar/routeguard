/**
 * Open Redirect Sink Detector
 *
 * Detects tainted URLs in redirect operations:
 * - res.redirect(taintedUrl)
 * - res.redirect(statusCode, taintedUrl)
 * - reply.redirect(taintedUrl) (Fastify)
 * - reply.redirect(statusCode, taintedUrl) (Fastify)
 *
 * Safe when:
 * - URL is validated against an allowlist before redirect
 * - URL is a literal string (not user-supplied)
 * - URL is from a trusted source (config, database, etc.)
 *
 * This is taint analysis — traces user input to redirect sink.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Sink, TaintedSource } from '../ir/types';

/**
 * Detects open redirect sinks in a handler function body.
 *
 * @param handlerNode - The route handler function
 * @param taintedSources - User-supplied tainted sources from the handler
 * @returns Array of Sink nodes with kind 'redirect-url'
 */
export function detectOpenRedirectSinks(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  taintedSources: TaintedSource[]
): Sink[] {
  const sinks: Sink[] = [];

  // Handler body must be a block statement
  if (handlerNode.body.type !== 'BlockStatement') return sinks;

  // Walk the handler body looking for redirect calls
  walkStatements(handlerNode.body.body, (node) => {
    if (node.type === 'CallExpression') {
      const sink = detectRedirectCall(node, taintedSources);
      if (sink) sinks.push(sink);
    }
  });

  return sinks;
}

/**
 * Detects if a CallExpression is a redirect with tainted URL.
 *
 * Matches:
 * - res.redirect(url)
 * - res.redirect(301, url)
 * - reply.redirect(url) (Fastify)
 * - reply.redirect(301, url) (Fastify)
 *
 * Does NOT match:
 * - res.redirect('/hardcoded-path')
 * - res.redirect(301, '/hardcoded-path')
 * - other.redirect() where object is not res/reply
 */
function detectRedirectCall(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  // Must be: someObj.redirect(...)
  if (node.callee.type !== 'MemberExpression') return null;
  if (node.callee.object.type !== 'Identifier') return null;
  if (node.callee.property.type !== 'Identifier') return null;

  const objName = node.callee.object.name;
  const methodName = node.callee.property.name;

  // Must be res.redirect() or reply.redirect()
  if (!['res', 'reply', 'response'].includes(objName)) return null;
  if (methodName !== 'redirect') return null;

  // Determine which argument is the URL
  const urlInfo = getRedirectUrlArgument(node);
  if (!urlInfo) return null;

  // Check if URL argument is tainted
  const taintSource = traceTaint(urlInfo.urlArg, taintedSources);
  if (!taintSource) return null;

  return {
    kind: 'redirect-url',
    node: node,
    taintedArg: {
      argIndex: urlInfo.urlArgIndex,
      taintSource: taintSource,
      node: urlInfo.urlArg,
    },
  };
}

/**
 * Determines which argument contains the URL in a redirect call.
 *
 * Handles both overloads:
 * - redirect(url) — URL is arg 0
 * - redirect(statusCode, url) — URL is arg 1
 *
 * @param node - The redirect CallExpression
 * @returns URL argument info, or null if invalid
 */
function getRedirectUrlArgument(
  node: TSESTree.CallExpression
): { urlArg: TSESTree.Node; urlArgIndex: number } | null {
  const argCount = node.arguments.length;

  // No arguments = invalid
  if (argCount === 0) return null;

  // Single argument = URL
  if (argCount === 1) {
    return {
      urlArg: node.arguments[0],
      urlArgIndex: 0,
    };
  }

  // Two arguments = check if first is status code
  if (argCount === 2) {
    const firstArg = node.arguments[0];

    // First arg is numeric literal = status code, URL is second
    if (firstArg.type === 'Literal' && typeof firstArg.value === 'number') {
      return {
        urlArg: node.arguments[1],
        urlArgIndex: 1,
      };
    }

    // First arg is not a number = assume it's the URL (unusual but handle gracefully)
    return {
      urlArg: node.arguments[0],
      urlArgIndex: 0,
    };
  }

  // More than 2 arguments = invalid
  return null;
}

/**
 * Traces a node back to a tainted source.
 *
 * Handles:
 * - Direct identifier reference: `url` → traces to `const url = req.query.url`
 * - Member expression: `req.query.url` → matches tainted source directly
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
  // redirect(url) where url = req.query.url
  if (node.type === 'Identifier') {
    const varName = node.name;
    return taintedSources.find((src) => src.localName === varName) || null;
  }

  // Pattern 2: Direct member expression
  // redirect(req.query.url)
  if (node.type === 'MemberExpression') {
    // Check if this member expression matches any tainted source pattern
    // This is a simplified check — full implementation would need deeper tracing
    for (const source of taintedSources) {
      if (matchesTaintedMemberExpression(node, source)) {
        return source;
      }
    }
  }

  // Pattern 3: Template literal with tainted parts
  // redirect(`/redirect?url=${req.query.url}`)
  if (node.type === 'TemplateLiteral') {
    for (const expr of node.expressions) {
      const taint = traceTaint(expr, taintedSources);
      if (taint) return taint;
    }
  }

  // Pattern 4: Binary expression (string concatenation)
  // redirect('/redirect?url=' + req.query.url)
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const leftTaint = traceTaint(node.left, taintedSources);
    if (leftTaint) return leftTaint;

    const rightTaint = traceTaint(node.right, taintedSources);
    if (rightTaint) return rightTaint;
  }

  return null;
}

/**
 * Checks if a MemberExpression matches a tainted source pattern.
 *
 * Example:
 * - MemberExpression: req.query.url
 * - TaintedSource: { localName: 'url', requestKey: 'url', kind: 'query-param' }
 * - Match: true (both refer to req.query.url)
 */
function matchesTaintedMemberExpression(
  node: TSESTree.MemberExpression,
  source: TaintedSource
): boolean {
  // This is a simplified heuristic
  // Full implementation would need to track the exact AST path
  
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

    // Leaf nodes or nodes we don't need to traverse
    case 'Identifier':
    case 'Literal':
    case 'ThisExpression':
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