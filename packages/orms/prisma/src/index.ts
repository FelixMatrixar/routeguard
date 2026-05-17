/**
 * Prisma ORM Adapter — Reference ORM
 *
 * Converts Prisma query calls into Sink IR. The detection engine reads the
 * resulting `filterKeys` to decide BOLA / mass-assignment findings.
 *
 * Supported: findUnique, findFirst, findMany, update, updateMany, upsert,
 *            delete, deleteMany, create, createMany. Nested AND/OR/NOT.
 * Out of scope (v1): $queryRaw (handled by the raw-sql sink), $transaction.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Sink, FilterKey, TaintedSource, DbOperation, SinkKind } from '@routeguard/core';
import { classifyRequestMember, traceTaint, walkNode } from '@routeguard/core';

type OperationInfo = {
  operation: DbOperation;
  sinkKind: SinkKind;
  hasWhere: boolean;
  hasData: boolean;
};

/**
 * Walks a route handler and produces a Sink for every Prisma call found.
 *
 * @param handlerNode - The route handler function
 * @param taintedSources - User-controlled sources in scope
 * @param authContextExpr - Auth-context expression, e.g. 'req.user.id'
 * @returns Sinks for each Prisma query
 */
export function detectPrismaSinks(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): Sink[] {
  const sinks: Sink[] = [];
  if (handlerNode.body.type !== 'BlockStatement') return sinks;

  walkNode(handlerNode.body, (node) => {
    if (node.type !== 'CallExpression') return;
    const sink = detectPrismaSink(node, taintedSources, authContextExpr);
    if (sink) sinks.push(sink);
  });

  return sinks;
}

/**
 * Detects a single Prisma query call and produces Sink IR.
 *
 * @example prisma.order.findUnique({ where: { id } })
 *   → Sink { kind: 'db-filter', operation: 'read', model: 'order', filterKeys }
 */
export function detectPrismaSink(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): Sink | null {
  // Must be: prisma.MODEL.METHOD(...)
  if (node.callee.type !== 'MemberExpression') return null;
  const methodNode = node.callee;
  if (methodNode.property.type !== 'Identifier') return null;
  if (methodNode.object.type !== 'MemberExpression') return null;

  const modelNode = methodNode.object;
  if (modelNode.object.type !== 'Identifier' || modelNode.object.name !== 'prisma') {
    return null;
  }
  if (modelNode.property.type !== 'Identifier') return null;

  const methodName = methodNode.property.name;
  if (methodName.startsWith('$')) return null;

  const opInfo = getOperationInfo(methodName);
  if (!opInfo) return null;

  return {
    kind: opInfo.sinkKind,
    operation: opInfo.operation,
    model: modelNode.property.name,
    filterKeys: extractFilterKeys(node, opInfo, taintedSources, authContextExpr),
    node,
  };
}

/** Maps a Prisma method name to its operation kind. */
function getOperationInfo(methodName: string): OperationInfo | null {
  switch (methodName) {
    case 'findUnique':
    case 'findFirst':
    case 'findMany':
      return { operation: 'read', sinkKind: 'db-filter', hasWhere: true, hasData: false };
    case 'delete':
    case 'deleteMany':
      return { operation: 'delete', sinkKind: 'db-filter', hasWhere: true, hasData: false };
    case 'update':
    case 'updateMany':
    case 'upsert':
      return { operation: 'write', sinkKind: 'db-write', hasWhere: true, hasData: true };
    case 'create':
    case 'createMany':
      return { operation: 'write', sinkKind: 'db-write', hasWhere: false, hasData: true };
    default:
      return null;
  }
}

/** Extracts filter keys from the `where` and `data` clauses. */
function extractFilterKeys(
  node: TSESTree.CallExpression,
  opInfo: OperationInfo,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): FilterKey[] {
  const firstArg = node.arguments[0];
  if (!firstArg || firstArg.type !== 'ObjectExpression') return [];

  const keys: FilterKey[] = [];
  if (opInfo.hasWhere) {
    keys.push(...extractClause(firstArg, 'where', taintedSources, authContextExpr));
  }
  if (opInfo.hasData) {
    keys.push(...extractClause(firstArg, 'data', taintedSources, authContextExpr));
  }
  return keys;
}

/**
 * Extracts filter keys from a named clause.
 *
 * A clause whose value is a whole-object reference — `data: req.body` — yields
 * a single `(whole object)` key, so the engine still sees the taint. Without
 * this, the most common mass-assignment shape would be invisible.
 */
function extractClause(
  arg: TSESTree.ObjectExpression,
  clauseName: 'where' | 'data',
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): FilterKey[] {
  const prop = arg.properties.find(
    (p): p is TSESTree.Property =>
      p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === clauseName
  );
  if (!prop) return [];

  if (prop.value.type === 'ObjectExpression') {
    return extractObjectKeys(prop.value, taintedSources, authContextExpr);
  }

  // Whole-object spread: data: req.body / where: req.query
  const taintSource = traceTaint(prop.value, taintedSources);
  if (taintSource) {
    return [{ key: '(whole object)', valueKind: 'tainted', taintSource, node: prop.value }];
  }
  return [];
}

/** Extracts keys from an object literal, flattening nested AND/OR/NOT. */
function extractObjectKeys(
  obj: TSESTree.ObjectExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): FilterKey[] {
  const keys: FilterKey[] = [];

  for (const prop of obj.properties) {
    if (prop.type !== 'Property' || prop.key.type !== 'Identifier') continue;
    const key = prop.key.name;

    if ((key === 'AND' || key === 'OR') && prop.value.type === 'ArrayExpression') {
      for (const elem of prop.value.elements) {
        if (elem?.type === 'ObjectExpression') {
          keys.push(...extractObjectKeys(elem, taintedSources, authContextExpr));
        }
      }
      continue;
    }
    if (key === 'NOT' && prop.value.type === 'ObjectExpression') {
      keys.push(...extractObjectKeys(prop.value, taintedSources, authContextExpr));
      continue;
    }

    keys.push({
      key,
      valueKind: classifyValueKind(prop.value, taintedSources, authContextExpr),
      taintSource: traceTaint(prop.value, taintedSources) ?? undefined,
      node: prop.value,
    });
  }

  return keys;
}

/** Classifies a filter value as tainted / auth-context / literal / unknown. */
function classifyValueKind(
  value: TSESTree.Node,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): FilterKey['valueKind'] {
  if (
    value.type === 'MemberExpression' &&
    authContextExpr &&
    buildMemberExpressionString(value) === authContextExpr
  ) {
    return 'auth-context';
  }
  if (traceTaint(value, taintedSources) || classifyRequestMember(value)) {
    return 'tainted';
  }
  if (value.type === 'Literal') return 'literal';
  return 'unknown';
}

/** Renders a member expression as a dotted string, e.g. `req.user.id`. */
function buildMemberExpressionString(node: TSESTree.MemberExpression): string {
  const parts: string[] = [];
  let current: TSESTree.Node = node;
  while (current.type === 'MemberExpression') {
    if (current.property.type === 'Identifier') parts.unshift(current.property.name);
    current = current.object;
  }
  if (current.type === 'Identifier') parts.unshift(current.name);
  return parts.join('.');
}
