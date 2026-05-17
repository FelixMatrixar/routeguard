/**
 * Prisma ORM Adapter — Reference Implementation
 *
 * Detects Prisma query calls and converts WHERE/DATA clauses to Sink IR.
 *
 * Supported: findUnique, findFirst, findMany, update, updateMany,
 *            delete, deleteMany, upsert, create, createMany
 * Nested where: AND/OR arrays
 * Out of scope (v1): $queryRaw (→ raw-sql adapter), $transaction
 *
 * AST shape for `prisma.order.findUnique({ where: { id } })`:
 *   CallExpression
 *     callee: MemberExpression
 *       object: MemberExpression        ← prisma.order
 *         object: Identifier(prisma)
 *         property: Identifier(order)   ← model name
 *       property: Identifier(findUnique)
 *     arguments[0]: ObjectExpression    ← { where: { ... } }
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Sink, FilterKey, TaintedSource, DbOperation, SinkKind } from '@routeguard/core';

/**
 * Detects Prisma query calls and produces Sink IR.
 *
 * @example
 * prisma.order.findUnique({ where: { id } })
 * → Sink { kind: 'db-filter', operation: 'read', model: 'order', filterKeys: [...] }
 *
 * @param node - CallExpression to analyze
 * @param taintedSources - Known tainted sources from route handler
 * @param authContextExpr - Auth context expression (e.g., 'req.user.id')
 * @returns Sink object or null if not a Prisma call
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
  
  // Check for prisma.MODEL pattern
  if (methodNode.object.type !== 'MemberExpression') return null;
  const modelNode = methodNode.object;
  
  if (modelNode.object.type !== 'Identifier') return null;
  if (modelNode.object.name !== 'prisma') return null;
  if (modelNode.property.type !== 'Identifier') return null;
  
  const methodName = methodNode.property.name;
  const modelName = modelNode.property.name;
  
  // Skip special Prisma methods starting with $
  if (methodName.startsWith('$')) return null;
  
  // Determine operation type and sink kind
  const opInfo = getOperationInfo(methodName);
  if (!opInfo) return null;
  
  // Extract filter keys from where and/or data clauses
  const filterKeys = extractFilterKeys(node, opInfo, taintedSources, authContextExpr);
  
  return {
    kind: opInfo.sinkKind,
    operation: opInfo.operation,
    model: modelName,
    filterKeys,
    node,
  };
}

/**
 * Maps Prisma method names to operation types and sink kinds.
 */
function getOperationInfo(methodName: string): {
  operation: DbOperation;
  sinkKind: SinkKind;
  hasWhere: boolean;
  hasData: boolean;
} | null {
  switch (methodName) {
    // Read operations → db-filter
    case 'findUnique':
    case 'findFirst':
    case 'findMany':
      return { operation: 'read', sinkKind: 'db-filter', hasWhere: true, hasData: false };
    
    // Delete operations → db-filter (filter determines what gets deleted)
    case 'delete':
    case 'deleteMany':
      return { operation: 'delete', sinkKind: 'db-filter', hasWhere: true, hasData: false };
    
    // Write operations → db-write
    case 'update':
    case 'updateMany':
      return { operation: 'write', sinkKind: 'db-write', hasWhere: true, hasData: true };
    
    case 'upsert':
      return { operation: 'write', sinkKind: 'db-write', hasWhere: true, hasData: true };
    
    case 'create':
    case 'createMany':
      return { operation: 'write', sinkKind: 'db-write', hasWhere: false, hasData: true };
    
    default:
      return null;
  }
}

/**
 * Extracts filter keys from Prisma call arguments.
 *
 * For db-filter: extracts from 'where' clause
 * For db-write: extracts from both 'where' AND 'data' clauses
 */
function extractFilterKeys(
  node: TSESTree.CallExpression,
  opInfo: { hasWhere: boolean; hasData: boolean },
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): FilterKey[] {
  const filterKeys: FilterKey[] = [];
  
  // First argument must be an object
  if (node.arguments.length === 0) return filterKeys;
  const firstArg = node.arguments[0];
  if (firstArg.type !== 'ObjectExpression') return filterKeys;
  
  // Extract from 'where' clause
  if (opInfo.hasWhere) {
    const whereProp = firstArg.properties.find(
      p => p.type === 'Property' && 
           p.key.type === 'Identifier' && 
           p.key.name === 'where'
    );
    
    if (whereProp && whereProp.type === 'Property' && whereProp.value.type === 'ObjectExpression') {
      filterKeys.push(...extractFromWhereClause(whereProp.value, taintedSources, authContextExpr));
    }
  }
  
  // Extract from 'data' clause (for write operations)
  if (opInfo.hasData) {
    const dataProp = firstArg.properties.find(
      p => p.type === 'Property' && 
           p.key.type === 'Identifier' && 
           p.key.name === 'data'
    );
    
    if (dataProp && dataProp.type === 'Property' && dataProp.value.type === 'ObjectExpression') {
      filterKeys.push(...extractFromDataClause(dataProp.value, taintedSources, authContextExpr));
    }
  }
  
  return filterKeys;
}

/**
 * Extracts filter keys from 'where' clause.
 *
 * Handles nested AND/OR arrays by flattening them.
 *
 * @example
 * { id, userId: req.user.id }
 * → [{ key: 'id', valueKind: 'tainted' }, { key: 'userId', valueKind: 'auth-context' }]
 *
 * @example
 * { AND: [{ id }, { userId: req.user.id }] }
 * → [{ key: 'id', valueKind: 'tainted' }, { key: 'userId', valueKind: 'auth-context' }]
 */
function extractFromWhereClause(
  whereObj: TSESTree.ObjectExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): FilterKey[] {
  const filterKeys: FilterKey[] = [];
  
  for (const prop of whereObj.properties) {
    if (prop.type !== 'Property') continue;
    if (prop.key.type !== 'Identifier') continue;
    
    const key = prop.key.name;
    
    // Handle nested AND/OR arrays
    if ((key === 'AND' || key === 'OR') && prop.value.type === 'ArrayExpression') {
      for (const elem of prop.value.elements) {
        if (elem?.type === 'ObjectExpression') {
          // Recursively extract from each condition in the array
          filterKeys.push(...extractFromWhereClause(elem, taintedSources, authContextExpr));
        }
      }
      continue;
    }
    
    // Handle nested NOT
    if (key === 'NOT' && prop.value.type === 'ObjectExpression') {
      filterKeys.push(...extractFromWhereClause(prop.value, taintedSources, authContextExpr));
      continue;
    }
    
    // Regular filter key
    const valueKind = classifyValueKind(prop.value, taintedSources, authContextExpr);
    const taintSource = findTaintSource(prop.value, taintedSources);
    
    filterKeys.push({
      key,
      valueKind,
      taintSource,
      node: prop.value,
    });
  }
  
  return filterKeys;
}

/**
 * Extracts filter keys from 'data' clause.
 *
 * For mass assignment detection, we treat data fields as potential taint sinks.
 *
 * @example
 * { name, email: req.body.email }
 * → [{ key: 'name', valueKind: 'tainted' }, { key: 'email', valueKind: 'tainted' }]
 */
function extractFromDataClause(
  dataObj: TSESTree.ObjectExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): FilterKey[] {
  const filterKeys: FilterKey[] = [];
  
  for (const prop of dataObj.properties) {
    if (prop.type !== 'Property') continue;
    if (prop.key.type !== 'Identifier') continue;
    
    const key = prop.key.name;
    const valueKind = classifyValueKind(prop.value, taintedSources, authContextExpr);
    const taintSource = findTaintSource(prop.value, taintedSources);
    
    filterKeys.push({
      key,
      valueKind,
      taintSource,
      node: prop.value,
    });
  }
  
  return filterKeys;
}

/**
 * Classifies the value kind of a filter key.
 *
 * Returns:
 * - 'tainted' if value traces to a TaintedSource
 * - 'auth-context' if value is req.user.id (or configured equivalent)
 * - 'literal' if value is a hardcoded string/number
 * - 'unknown' otherwise
 */
function classifyValueKind(
  valueNode: TSESTree.Expression | TSESTree.Pattern,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): FilterKey['valueKind'] {
  // Check if it's a tainted identifier
  if (valueNode.type === 'Identifier') {
    const isTainted = taintedSources.some(s => s.localName === valueNode.name);
    if (isTainted) return 'tainted';
  }
  
  // Check if it's auth context (req.user.id)
  if (valueNode.type === 'MemberExpression' && authContextExpr) {
    const exprStr = buildMemberExpressionString(valueNode);
    if (exprStr === authContextExpr) return 'auth-context';
  }
  
  // Check if it's a literal value
  if (valueNode.type === 'Literal') {
    return 'literal';
  }
  
  // Everything else is unknown (computed values, function calls, etc.)
  return 'unknown';
}

/**
 * Builds a string representation of a MemberExpression.
 *
 * @example
 * req.user.id → 'req.user.id'
 */
function buildMemberExpressionString(node: TSESTree.MemberExpression): string {
  const parts: string[] = [];
  
  let current: TSESTree.Node = node;
  while (current.type === 'MemberExpression') {
    if (current.property.type === 'Identifier') {
      parts.unshift(current.property.name);
    }
    current = current.object;
  }
  
  if (current.type === 'Identifier') {
    parts.unshift(current.name);
  }
  
  return parts.join('.');
}

/**
 * Finds the TaintedSource that corresponds to a value expression.
 *
 * @example
 * Value is Identifier('id') → finds TaintedSource with localName='id'
 */
function findTaintSource(
  valueNode: TSESTree.Expression | TSESTree.Pattern,
  taintedSources: TaintedSource[]
): TaintedSource | undefined {
  if (valueNode.type !== 'Identifier') return undefined;
  return taintedSources.find(s => s.localName === valueNode.name);
}

// Made with Bob
