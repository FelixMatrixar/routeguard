/**
 * TypeORM Adapter
 *
 * Detects TypeORM query calls and converts WHERE clauses to Sink IR.
 * Supports both Repository API and QueryBuilder API.
 *
 * Repository API (follows Prisma pattern):
 *   repository.findOne({ where: { id: orderId } })
 *   repository.update({ id }, { status })
 *
 * QueryBuilder API (SQL string + params):
 *   createQueryBuilder('order').where('order.id = :id', { id: orderId }).getOne()
 *   getRepository(Order).createQueryBuilder().where('id = :id', { id }).getOne()
 *
 * Out of scope (v1): query() raw SQL (→ raw-sql adapter), complex joins
 *
 * AST shapes documented in function headers below.
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
 * Walks a route handler and produces a Sink for every TypeORM call found.
 *
 * @param handlerNode - The route handler function
 * @param taintedSources - User-controlled sources in scope
 * @param authContextExpr - Auth-context expression, e.g. 'req.user.id'
 * @returns Sinks for each TypeORM query
 */
export function detectTypeORMSinks(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): Sink[] {
  const sinks: Sink[] = [];
  if (handlerNode.body.type !== 'BlockStatement') return sinks;

  walkNode(handlerNode.body, (node) => {
    if (node.type !== 'CallExpression') return;
    const sink = detectTypeORMSink(node, taintedSources, authContextExpr);
    if (sink) sinks.push(sink);
  });

  return sinks;
}

/**
 * Detects a single TypeORM query call and produces Sink IR.
 *
 * Handles both Repository API and QueryBuilder API.
 *
 * @example Repository API
 * repository.findOne({ where: { id: orderId } })
 * → Sink { kind: 'db-filter', operation: 'read', model: 'repository', filterKeys }
 *
 * @example QueryBuilder API
 * createQueryBuilder('order').where('order.id = :id', { id: orderId }).getOne()
 * → Sink { kind: 'db-filter', operation: 'read', model: 'order', filterKeys }
 */
export function detectTypeORMSink(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): Sink | null {
  // Try Repository API first
  const repoSink = detectRepositoryAPI(node, taintedSources, authContextExpr);
  if (repoSink) return repoSink;

  // Try QueryBuilder API
  const qbSink = detectQueryBuilderAPI(node, taintedSources, authContextExpr);
  if (qbSink) return qbSink;

  return null;
}

/**
 * Detects Repository API calls: repository.findOne({ where: { ... } })
 *
 * AST: CallExpression with callee = MemberExpression(repository.METHOD)
 * Nearly identical to Prisma pattern.
 */
function detectRepositoryAPI(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): Sink | null {
  if (node.callee.type !== 'MemberExpression') return null;
  if (node.callee.property.type !== 'Identifier') return null;

  const methodName = node.callee.property.name;
  const opInfo = getRepositoryOperationInfo(methodName);
  if (!opInfo) return null;

  // Model name is the repository variable name.
  // Must be determinable to avoid false-positive matches on Prisma-style
  // client.model.method() chains where callee.object is a MemberExpression
  // with an Identifier base (e.g. prisma.file.delete()).
  let modelName: string | null = null;
  if (node.callee.object.type === 'Identifier') {
    modelName = node.callee.object.name;
  } else if (
    node.callee.object.type === 'MemberExpression' &&
    node.callee.object.object.type === 'ThisExpression' &&
    node.callee.object.property.type === 'Identifier'
  ) {
    // NestJS injection pattern: this.userRepository.findOne()
    modelName = node.callee.object.property.name;
  }
  if (!modelName) return null;

  const filterKeys = extractRepositoryFilterKeys(node, opInfo, taintedSources, authContextExpr);

  return {
    kind: opInfo.sinkKind,
    operation: opInfo.operation,
    model: modelName,
    filterKeys,
    node,
  };
}

/**
 * Maps Repository API method names to operation info.
 */
function getRepositoryOperationInfo(methodName: string): OperationInfo | null {
  switch (methodName) {
    case 'findOne':
    case 'findOneBy':
    case 'find':
    case 'findBy':
    case 'findAndCount':
    case 'count':
      return { operation: 'read', sinkKind: 'db-filter', hasWhere: true, hasData: false };
    
    case 'delete':
    case 'remove':
    case 'softDelete':
      return { operation: 'delete', sinkKind: 'db-filter', hasWhere: true, hasData: false };
    
    case 'update':
      return { operation: 'write', sinkKind: 'db-write', hasWhere: true, hasData: true };
    
    case 'save':
    case 'insert':
      return { operation: 'write', sinkKind: 'db-write', hasWhere: false, hasData: true };
    
    default:
      return null;
  }
}

/**
 * Extracts filter keys from Repository API call arguments.
 *
 * Similar to Prisma: { where: { ... }, data: { ... } }
 */
function extractRepositoryFilterKeys(
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
  
  // For update(), second argument is the data
  if (opInfo.hasData && node.arguments.length > 1) {
    const secondArg = node.arguments[1];
    if (secondArg.type === 'ObjectExpression') {
      keys.push(...extractObjectKeys(secondArg, taintedSources, authContextExpr));
    }
  }

  return keys;
}

/**
 * Detects QueryBuilder API calls: createQueryBuilder().where().getOne()
 *
 * AST: CallExpression chain ending with .getOne()/.getMany()/.execute()
 * Must walk backwards to find .where() and createQueryBuilder()
 */
function detectQueryBuilderAPI(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): Sink | null {
  if (node.callee.type !== 'MemberExpression') return null;
  if (node.callee.property.type !== 'Identifier') return null;

  const finalMethod = node.callee.property.name;
  
  // Check if this is a QueryBuilder termination method
  const opInfo = getQueryBuilderOperationInfo(finalMethod);
  if (!opInfo) return null;

  // Walk backwards through chain to find .where() and table name
  const chainInfo = analyzeQueryBuilderChain(node);
  if (!chainInfo) return null;

  return {
    kind: opInfo.sinkKind,
    operation: opInfo.operation,
    model: chainInfo.tableName,
    filterKeys: chainInfo.filterKeys,
    node,
  };
}

/**
 * Maps QueryBuilder termination methods to operation info.
 */
function getQueryBuilderOperationInfo(methodName: string): OperationInfo | null {
  switch (methodName) {
    case 'getOne':
    case 'getMany':
    case 'getRawOne':
    case 'getRawMany':
    case 'getCount':
      return { operation: 'read', sinkKind: 'db-filter', hasWhere: true, hasData: false };
    
    case 'execute':
      // Could be UPDATE or DELETE - we'll determine from chain
      return { operation: 'write', sinkKind: 'db-write', hasWhere: true, hasData: false };
    
    default:
      return null;
  }
}

/**
 * Analyzes QueryBuilder call chain to extract table name and filter keys.
 *
 * Walks backwards from final method through:
 * - .getOne() ← current
 * - .where('condition', params) ← extract filter keys
 * - .update()/.delete() ← optional, changes operation
 * - createQueryBuilder('table') ← extract table name
 */
function analyzeQueryBuilderChain(
  finalNode: TSESTree.CallExpression
): { tableName: string; filterKeys: FilterKey[] } | null {
  let tableName: string | null = null;
  const filterKeys: FilterKey[] = [];
  
  let current: TSESTree.Node = finalNode.callee.type === 'MemberExpression' 
    ? finalNode.callee.object 
    : finalNode;

  // Walk backwards through the chain
  while (current.type === 'CallExpression') {
    if (current.callee.type !== 'MemberExpression') break;
    if (current.callee.property.type !== 'Identifier') break;

    const methodName = current.callee.property.name;

    // Extract from .where() call
    if (methodName === 'where' || methodName === 'andWhere' || methodName === 'orWhere') {
      const whereKeys = extractQueryBuilderWhereKeys(current);
      filterKeys.push(...whereKeys);
    }

    // Extract table name from createQueryBuilder('table')
    if (methodName === 'createQueryBuilder') {
      tableName = extractTableFromQueryBuilder(current);
      break;
    }

    current = current.callee.object;
  }

  if (!tableName) return null;

  return { tableName, filterKeys };
}

/**
 * Extracts table name from createQueryBuilder('table') call.
 */
function extractTableFromQueryBuilder(node: TSESTree.CallExpression): string | null {
  if (node.arguments.length === 0) return null;
  const firstArg = node.arguments[0];
  if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
    return firstArg.value;
  }
  return null;
}

/**
 * Extracts filter keys from QueryBuilder .where() call.
 *
 * .where() signature: .where(condition: string, parameters?: object)
 * 
 * @example
 * .where('order.id = :id', { id: orderId })
 * → Extract 'id' from params object, classify orderId value
 *
 * V1 limitation: We extract params but don't parse the SQL condition string.
 * We treat all params as filter keys without column name mapping.
 */
function extractQueryBuilderWhereKeys(whereNode: TSESTree.CallExpression): FilterKey[] {
  // Second argument is the parameters object
  if (whereNode.arguments.length < 2) return [];
  
  const paramsArg = whereNode.arguments[1];
  if (paramsArg.type !== 'ObjectExpression') return [];

  // Extract all properties from params object
  // Note: We don't parse the SQL string, so we can't map :id to column names
  // We just know these are filter parameters
  const keys: FilterKey[] = [];
  
  for (const prop of paramsArg.properties) {
    if (prop.type !== 'Property') continue;
    if (prop.key.type !== 'Identifier') continue;

    keys.push({
      key: prop.key.name,
      valueKind: 'unknown', // V1: simplified - would need SQL parsing
      node: prop.value,
    });
  }

  return keys;
}

/**
 * Extracts filter keys from a named clause (where/data).
 *
 * Handles whole-object spread: where: req.query
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

  // Whole-object spread: where: req.query
  const taintSource = traceTaint(prop.value, taintedSources);
  if (taintSource) {
    return [{ key: '(whole object)', valueKind: 'tainted', taintSource, node: prop.value }];
  }
  
  return [];
}

/**
 * Extracts keys from an object literal.
 */
function extractObjectKeys(
  obj: TSESTree.ObjectExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): FilterKey[] {
  const keys: FilterKey[] = [];

  for (const prop of obj.properties) {
    if (prop.type !== 'Property' || prop.key.type !== 'Identifier') continue;

    keys.push({
      key: prop.key.name,
      valueKind: classifyValueKind(prop.value, taintedSources, authContextExpr),
      taintSource: traceTaint(prop.value, taintedSources) ?? undefined,
      node: prop.value,
    });
  }

  return keys;
}

/**
 * Classifies a filter value as tainted / auth-context / literal / unknown.
 */
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

/**
 * Renders a member expression as a dotted string, e.g. `req.user.id`.
 */
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

// Made with Bob