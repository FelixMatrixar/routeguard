/**
 * Raw SQL Adapter
 *
 * Detects raw SQL queries and identifies SQL injection risks.
 * Does NOT use node-sql-parser (V1 simplification).
 *
 * Supported patterns:
 *   db.query(`SELECT ... WHERE id = '${tainted}'`) → UNSAFE (template literal with tainted expression)
 *   pool.query('SELECT ... WHERE id = $1', [tainted]) → SAFE (parameterized)
 *   sql`SELECT ... WHERE id = ${tainted}` → SAFE (tagged template with safe tag)
 *   db.query('SELECT ... WHERE id = ' + tainted) → UNANALYZABLE (string concatenation)
 *
 * V1 limitations:
 *   - No SQL parsing (would need node-sql-parser for column extraction)
 *   - String concatenation flagged as unanalyzable, not analyzed
 *   - Tagged templates assumed safe if tag is in safe list
 *
 * AST shapes documented in function headers below.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Sink, TaintedSource } from '@routeguard/core';
import { traceTaint, walkNode } from '@routeguard/core';

/**
 * List of safe tagged template function names.
 * These functions are known to properly escape/parameterize SQL.
 */
const SAFE_SQL_TAGS = new Set([
  'sql',           // Common SQL builder tag
  'prisma',        // Prisma raw query tag
  'kysely',        // Kysely query builder
  'knex',          // Knex query builder
]);

/**
 * Walks a route handler and produces a Sink for every raw SQL call found.
 *
 * @param handlerNode - The route handler function
 * @param taintedSources - User-controlled sources in scope
 * @returns Sinks for each raw SQL query
 */
export function detectRawSQLSinks(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  taintedSources: TaintedSource[]
): Sink[] {
  const sinks: Sink[] = [];
  if (handlerNode.body.type !== 'BlockStatement') return sinks;

  walkNode(handlerNode.body, (node) => {
    // Check for CallExpression with .query() method
    if (node.type === 'CallExpression') {
      const sink = detectQueryCallSink(node, taintedSources);
      if (sink) sinks.push(sink);
    }
    
    // Check for TaggedTemplateExpression
    if (node.type === 'TaggedTemplateExpression') {
      const sink = detectTaggedTemplateSink(node, taintedSources);
      if (sink) sinks.push(sink);
    }
  });

  return sinks;
}

/**
 * Detects raw SQL in .query() calls.
 *
 * Patterns:
 * 1. db.query(`SELECT ... ${tainted}`) → UNSAFE template literal
 * 2. pool.query('SELECT ...', [params]) → SAFE parameterized
 * 3. db.query('SELECT ...' + tainted) → UNANALYZABLE string concat
 *
 * @example UNSAFE
 * db.query(`SELECT * FROM orders WHERE id = '${req.params.id}'`)
 * → Sink { kind: 'raw-sql', taintedArg: { argIndex: 0, ... } }
 *
 * @example SAFE (no sink returned)
 * pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id])
 * → null (parameterized queries are safe)
 */
function detectQueryCallSink(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  // Must be: someObj.query(...)
  if (node.callee.type !== 'MemberExpression') return null;
  if (node.callee.property.type !== 'Identifier') return null;
  if (node.callee.property.name !== 'query') return null;
  
  if (node.arguments.length === 0) return null;
  const firstArg = node.arguments[0];
  
  // Pattern 1: Template literal with tainted expressions
  if (firstArg.type === 'TemplateLiteral') {
    return detectTemplateLiteralSink(firstArg, node, taintedSources);
  }
  
  // Pattern 2: Parameterized query (SAFE - no sink)
  // Second argument is array of parameters
  if (node.arguments.length >= 2 && node.arguments[1].type === 'ArrayExpression') {
    // This is a parameterized query - considered safe
    return null;
  }
  
  // Pattern 3: String concatenation (UNANALYZABLE)
  if (firstArg.type === 'BinaryExpression' && firstArg.operator === '+') {
    // String concatenation detected - flag as unanalyzable
    // V1: We don't analyze this, just note it exists
    return {
      kind: 'raw-sql',
      node,
      // No taintedArg - this indicates unanalyzable pattern
    };
  }
  
  return null;
}

/**
 * Detects SQL injection in template literals.
 *
 * AST: TemplateLiteral with expressions[] containing tainted values.
 *
 * @example
 * `SELECT * FROM orders WHERE id = '${req.params.id}'`
 * → TemplateLiteral { expressions: [MemberExpression(req.params.id)] }
 */
function detectTemplateLiteralSink(
  templateNode: TSESTree.TemplateLiteral,
  callNode: TSESTree.CallExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  // Check each expression in the template literal
  for (let i = 0; i < templateNode.expressions.length; i++) {
    const expr = templateNode.expressions[i];
    const taintSource = traceTaint(expr, taintedSources);
    
    if (taintSource) {
      return {
        kind: 'raw-sql',
        node: callNode,
        taintedArg: {
          argIndex: 0,
          taintSource,
          node: expr,
        },
      };
    }
  }
  
  return null;
}

/**
 * Detects SQL injection in tagged template expressions.
 *
 * AST: TaggedTemplateExpression { tag: Identifier, quasi: TemplateLiteral }
 *
 * @example SAFE (known safe tag)
 * sql`SELECT * FROM orders WHERE id = ${req.params.id}`
 * → null (sql tag is in SAFE_SQL_TAGS)
 *
 * @example UNSAFE (unknown tag)
 * customTag`SELECT * FROM orders WHERE id = ${req.params.id}`
 * → Sink { kind: 'raw-sql', ... }
 */
function detectTaggedTemplateSink(
  node: TSESTree.TaggedTemplateExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  // Check if tag is in safe list
  if (node.tag.type === 'Identifier' && SAFE_SQL_TAGS.has(node.tag.name)) {
    // Known safe tag - no sink
    return null;
  }
  
  // Check if tag is a member expression like prisma.$queryRaw
  if (node.tag.type === 'MemberExpression') {
    if (node.tag.property.type === 'Identifier') {
      const methodName = node.tag.property.name;
      // Check for known safe methods
      if (methodName === '$queryRaw' || methodName === 'raw') {
        return null;
      }
    }
  }
  
  // Unknown tag - check for tainted expressions
  const templateLiteral = node.quasi;
  for (let i = 0; i < templateLiteral.expressions.length; i++) {
    const expr = templateLiteral.expressions[i];
    const taintSource = traceTaint(expr, taintedSources);
    
    if (taintSource) {
      return {
        kind: 'raw-sql',
        node,
        taintedArg: {
          argIndex: i,
          taintSource,
          node: expr,
        },
      };
    }
  }
  
  return null;
}

/**
 * Checks if a node contains string concatenation.
 *
 * Used to detect patterns like: 'SELECT ... WHERE id = ' + req.params.id
 * V1: We flag these as unanalyzable rather than trying to parse them.
 */
export function hasStringConcatenation(node: TSESTree.Node): boolean {
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    // Check if either side is a string
    if (node.left.type === 'Literal' && typeof node.left.value === 'string') {
      return true;
    }
    if (node.right.type === 'Literal' && typeof node.right.value === 'string') {
      return true;
    }
    // Recursively check nested concatenation
    return hasStringConcatenation(node.left) || hasStringConcatenation(node.right);
  }
  return false;
}

// Made with Bob