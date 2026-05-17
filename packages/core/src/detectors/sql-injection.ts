/**
 * SQL Injection Sink Detector
 *
 * Detects tainted input in raw SQL:
 *   db.query(`SELECT ... ${tainted}`)
 *   pool.query('SELECT ...' + tainted)
 *   sql`SELECT ... ${tainted}` (tagged templates)
 *
 * Safe: parameterized queries — a literal SQL string with placeholders
 * (?, $1, :name) plus a params array/object as the second argument.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Sink, TaintedSource } from '../ir/types';
import { traceTaint, walkNode } from '../taint';

// `exec` is intentionally excluded — it collides with child_process.exec,
// which the command-injection detector owns. Precision over recall.
const SQL_METHODS = ['query', 'execute', 'raw', 'unsafe'];
const SQL_TAGS = ['sql', 'SQL', 'raw', 'unsafe'];

/**
 * Detects SQL injection sinks in a route handler body.
 *
 * @param handlerNode - The route handler function
 * @param taintedSources - User-controlled sources in scope
 * @returns Sinks with kind 'raw-sql'
 */
export function detectSQLInjectionSinks(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  taintedSources: TaintedSource[]
): Sink[] {
  const sinks: Sink[] = [];
  if (handlerNode.body.type !== 'BlockStatement') return sinks;

  walkNode(handlerNode.body, (node) => {
    if (node.type === 'CallExpression') {
      const sink = detectSQLQueryCall(node, taintedSources);
      if (sink) sinks.push(sink);
    } else if (node.type === 'TaggedTemplateExpression') {
      const sink = detectTaggedSQLTemplate(node, taintedSources);
      if (sink) sinks.push(sink);
    }
  });

  return sinks;
}

/** db.query(taintedSql) — vulnerable unless parameterized. */
function detectSQLQueryCall(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  if (
    node.callee.type !== 'MemberExpression' ||
    node.callee.property.type !== 'Identifier' ||
    !SQL_METHODS.includes(node.callee.property.name)
  ) {
    return null;
  }

  const sqlArg = node.arguments[0];
  if (!sqlArg) return null;
  if (isSafeParameterizedQuery(node)) return null;

  const taint = traceTaint(sqlArg, taintedSources);
  if (!taint) return null;

  return {
    kind: 'raw-sql',
    node,
    taintedArg: { argIndex: 0, taintSource: taint, node: sqlArg },
  };
}

/**
 * Safe parameterized form: a literal SQL string containing placeholders,
 * with the values supplied as a separate array/object argument.
 */
function isSafeParameterizedQuery(node: TSESTree.CallExpression): boolean {
  const [sqlArg, paramsArg] = node.arguments;
  if (!sqlArg || !paramsArg) return false;
  if (sqlArg.type !== 'Literal' || typeof sqlArg.value !== 'string') return false;
  if (paramsArg.type !== 'ArrayExpression' && paramsArg.type !== 'ObjectExpression') {
    return false;
  }
  return /\?|\$\d+|:\w+|@\w+/.test(sqlArg.value);
}

/** sql`SELECT ... ${tainted}` */
function detectTaggedSQLTemplate(
  node: TSESTree.TaggedTemplateExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  if (node.tag.type !== 'Identifier' || !SQL_TAGS.includes(node.tag.name)) {
    return null;
  }
  for (const expr of node.quasi.expressions) {
    const taint = traceTaint(expr, taintedSources);
    if (taint) {
      return {
        kind: 'raw-sql',
        node,
        taintedArg: { argIndex: 0, taintSource: taint, node: expr },
      };
    }
  }
  return null;
}
