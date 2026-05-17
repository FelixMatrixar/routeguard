/**
 * SQL Injection Sink Detector
 *
 * Detects tainted input in raw SQL queries:
 * - db.query(`SELECT ... WHERE id = '${tainted}'`)
 * - pool.query('SELECT ...' + tainted)
 * - connection.execute(taintedSQL)
 * - sql`SELECT ... WHERE id = ${tainted}` (tagged templates)
 *
 * Safe when:
 * - Parameterized queries: db.query('SELECT ... WHERE id = ?', [value])
 * - Prepared statements with params array/object
 * - SQL is a literal string (not user-supplied)
 *
 * This is taint analysis — traces user input to SQL execution sink.
 *
 * TODO: Integrate node-sql-parser for deeper SQL analysis once dependency is added.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Sink, TaintedSource } from '../ir/types';

/**
 * Detects SQL injection sinks in a handler function body.
 *
 * @param handlerNode - The route handler function
 * @param taintedSources - User-supplied tainted sources from the handler
 * @returns Array of Sink nodes with kind 'raw-sql'
 */
export function detectSQLInjectionSinks(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  taintedSources: TaintedSource[]
): Sink[] {
  const sinks: Sink[] = [];

  // Handler body must be a block statement
  if (handlerNode.body.type !== 'BlockStatement') return sinks;

  // Walk the handler body looking for SQL query calls
  walkStatements(handlerNode.body.body, (node) => {
    // Pattern 1: db.query() with tainted SQL
    if (node.type === 'CallExpression') {
      const sink = detectSQLQueryCall(node, taintedSources);
      if (sink) sinks.push(sink);
    }

    // Pattern 2: sql`...` tagged template
    if (node.type === 'TaggedTemplateExpression') {
      const sink = detectTaggedSQLTemplate(node, taintedSources);
      if (sink) sinks.push(sink);
    }
  });

  return sinks;
}

/**
 * Detects SQL query calls with tainted SQL string.
 *
 * Vulnerable:
 * - db.query(`SELECT ... ${tainted}`)
 * - pool.query('SELECT ...' + tainted)
 * - connection.execute(taintedSQL)
 *
 * Safe:
 * - db.query('SELECT ... WHERE id = ?', [tainted])
 * - pool.query('SELECT ... WHERE id = $1', [tainted])
 * - db.query('SELECT ... WHERE id = :id', { id: tainted })
 */
function detectSQLQueryCall(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  
  // Must be: someObj.method(...)
  if (node.callee.type !== 'MemberExpression') return null;
  if (node.callee.property.type !== 'Identifier') return null;
  
  const methodName = node.callee.property.name;
  
  // Check if it's a SQL query method
  const sqlMethods = [
    'query', 'execute', 'raw', 'run', 'all', 'get', 'exec',
    'prepare', 'transaction', 'unsafe', // Postgres/MySQL variants
  ];
  if (!sqlMethods.includes(methodName)) return null;
  
  // Get the SQL argument (first argument)
  if (node.arguments.length === 0) return null;
  const sqlArg = node.arguments[0];
  
  // Check if using safe parameterized form
  if (isSafeParameterizedQuery(node)) {
    return null; // Safe — using placeholders with params array/object
  }
  
  // Find taint in the SQL string
  const taint = findTaintInSQL(sqlArg, taintedSources);
  if (!taint) return null;
  
  // Vulnerable — tainted SQL string
  return {
    kind: 'raw-sql',
    node: node,
    taintedArg: {
      argIndex: 0,
      taintSource: taint.taintSource,
      node: taint.taintedNode,
    },
  };
}

/**
 * Checks if a query call uses safe parameterized form.
 *
 * Safe patterns:
 * - db.query('SELECT ... WHERE id = ?', [value])
 * - pool.query('SELECT ... WHERE id = $1', [value])
 * - connection.execute('SELECT ... WHERE id = ?', [value])
 * - db.query('SELECT ... WHERE id = :id', { id: value })
 *
 * Detection:
 * - First arg is a Literal (not template/concatenation)
 * - Second arg is an ArrayExpression or ObjectExpression (parameters)
 * - SQL contains placeholders (?, $1, :name)
 */
function isSafeParameterizedQuery(node: TSESTree.CallExpression): boolean {
  if (node.arguments.length < 2) return false;
  
  const sqlArg = node.arguments[0];
  const paramsArg = node.arguments[1];
  
  // SQL must be a literal string (not template or concatenation)
  if (sqlArg.type !== 'Literal') return false;
  if (typeof sqlArg.value !== 'string') return false;
  
  // Params must be an array or object
  if (paramsArg.type !== 'ArrayExpression' && paramsArg.type !== 'ObjectExpression') {
    return false;
  }
  
  // SQL string should contain placeholders
  const sql = sqlArg.value;
  const hasPlaceholders = containsSQLPlaceholders(sql);
  
  return hasPlaceholders;
}

/**
 * Checks if a SQL string contains parameterized query placeholders.
 *
 * Matches:
 * - ? — MySQL/SQLite positional placeholders
 * - $1, $2, $3 — PostgreSQL positional placeholders
 * - :name, :id — Named placeholders
 * - @param — SQL Server named parameters
 *
 * TODO: Use node-sql-parser for more robust detection once dependency is added.
 */
function containsSQLPlaceholders(sql: string): boolean {
  // Match common placeholder patterns
  const placeholderPatterns = [
    /\?/,              // MySQL/SQLite: ?
    /\$\d+/,           // PostgreSQL: $1, $2, etc.
    /:\w+/,            // Named: :id, :name, etc.
    /@\w+/,            // SQL Server: @param
  ];
  
  return placeholderPatterns.some(pattern => pattern.test(sql));
}

/**
 * Finds tainted input within a SQL argument.
 *
 * Handles:
 * - Template literals: `SELECT ... WHERE id = '${req.params.id}'`
 * - String concatenation: 'SELECT ...' + req.params.id
 * - Direct tainted values: req.params.id
 * - Identifiers: sql (where sql = `SELECT ... ${req.params.id}`)
 *
 * @returns Taint info if found, null if SQL is safe
 */
function findTaintInSQL(
  sqlArg: TSESTree.Node,
  taintedSources: TaintedSource[]
): { taintedNode: TSESTree.Node; taintSource: TaintedSource } | null {
  
  // Pattern 1: Template literal with tainted expression
  // `SELECT ... WHERE id = '${req.params.id}'`
  if (sqlArg.type === 'TemplateLiteral') {
    for (const expr of sqlArg.expressions) {
      const taint = traceTaint(expr, taintedSources);
      if (taint) {
        return { taintedNode: expr, taintSource: taint };
      }
    }
  }
  
  // Pattern 2: String concatenation
  // 'SELECT ... WHERE id = ' + req.params.id
  if (sqlArg.type === 'BinaryExpression' && sqlArg.operator === '+') {
    const leftTaint = findTaintInSQL(sqlArg.left, taintedSources);
    if (leftTaint) return leftTaint;
    
    const rightTaint = findTaintInSQL(sqlArg.right, taintedSources);
    if (rightTaint) return rightTaint;
  }
  
  // Pattern 3: Direct tainted identifier or member expression
  const taint = traceTaint(sqlArg, taintedSources);
  if (taint) {
    return { taintedNode: sqlArg, taintSource: taint };
  }
  
  return null;
}

/**
 * Detects tagged template SQL with tainted expressions.
 *
 * Pattern: sql`SELECT ... WHERE id = ${req.params.id}`
 *
 * Note: Some libraries like sql-template-strings or Prisma's sql tag
 * auto-escape parameters, but we flag for safety unless we can verify
 * the specific library's behavior.
 *
 * Known safe libraries (future enhancement):
 * - @prisma/client sql tag (auto-escapes)
 * - sql-template-strings (auto-escapes)
 * - postgres.js sql tag (auto-escapes)
 */
function detectTaggedSQLTemplate(
  node: TSESTree.TaggedTemplateExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  
  // Check if tag is a SQL-related identifier
  if (node.tag.type !== 'Identifier') return null;
  
  const tagName = node.tag.name;
  const sqlTags = ['sql', 'SQL', 'query', 'raw', 'unsafe'];
  if (!sqlTags.includes(tagName)) return null;
  
  // Check for tainted expressions in the template
  for (const expr of node.quasi.expressions) {
    const taint = traceTaint(expr, taintedSources);
    if (taint) {
      return {
        kind: 'raw-sql',
        node: node,
        taintedArg: {
          argIndex: 0,
          taintSource: taint,
          node: expr,
        },
      };
    }
  }
  
  return null;
}

/**
 * Traces a node back to a tainted source.
 *
 * Handles:
 * - Direct identifier reference: `id` → traces to `const id = req.params.id`
 * - Member expression: `req.params.id` → matches tainted source directly
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

  return null;
}

/**
 * Checks if a MemberExpression matches a tainted source pattern.
 */
function matchesTaintedMemberExpression(
  node: TSESTree.MemberExpression,
  source: TaintedSource
): boolean {
  if (node.property.type === 'Identifier') {
    return node.property.name === source.requestKey;
  }
  return false;
}

/**
 * Recursively walks statements and calls visitor for each node.
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
 */
function walkNode(node: TSESTree.Node, visitor: (node: TSESTree.Node) => void): void {
  visitor(node);

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

    case 'TaggedTemplateExpression':
      walkNode(node.quasi, visitor);
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

    case 'Identifier':
    case 'Literal':
    case 'ThisExpression':
    case 'BreakStatement':
    case 'ContinueStatement':
      break;

    default:
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