/**
 * Drizzle ORM Adapter
 *
 * Detects Drizzle query calls and converts WHERE/SET clauses to Sink IR.
 *
 * Supported: db.select().from(table).where(eq(...))
 *            db.update(table).set({...}).where(eq(...))
 *            db.delete().from(table).where(eq(...))
 *            db.insert(table).values({...})
 * Where helpers: eq(), ne(), and(), or(), gt(), lt(), gte(), lte()
 * Out of scope (v1): db.execute() (→ raw-sql adapter), transactions
 *
 * AST shape for `db.select().from(orders).where(eq(orders.id, id))`:
 *   CallExpression (outermost .where() call)
 *     callee: MemberExpression
 *       object: CallExpression (.from() call)
 *         callee: MemberExpression
 *           object: CallExpression (db.select() call)
 *           property: Identifier("from")
 *         arguments[0]: Identifier("orders") ← table name
 *       property: Identifier("where")
 *     arguments[0]: CallExpression (eq helper)
 *       callee: Identifier("eq")
 *       arguments: [column, value]
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Sink, FilterKey, TaintedSource, DbOperation, SinkKind } from '@routeguard/core';
import { walkNode } from '@routeguard/core';

/**
 * Walks a route handler and produces a Sink for every Drizzle call found.
 *
 * @param handlerNode - The route handler function
 * @param taintedSources - User-controlled sources in scope
 * @param authContextExpr - Auth-context expression, e.g. 'req.user.id'
 */
export function detectDrizzleSinks(
  handlerNode: TSESTree.Node,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): Sink[] {
  const sinks: Sink[] = [];

  walkNode(handlerNode, (node) => {
    if (node.type !== 'CallExpression') return;
    const sink = detectDrizzleSink(node, taintedSources, authContextExpr);
    if (sink) sinks.push(sink);
  });

  return sinks;
}

/**
 * Detects Drizzle query calls and produces Sink IR.
 *
 * @example
 * db.select().from(orders).where(eq(orders.id, id))
 * → Sink { kind: 'db-filter', operation: 'read', model: 'orders', filterKeys: [...] }
 *
 * @param node - CallExpression to analyze (should be final .where() or .values() call)
 * @param taintedSources - Known tainted sources from route handler
 * @param authContextExpr - Auth context expression (e.g., 'req.user.id')
 * @returns Sink object or null if not a Drizzle call
 */
export function detectDrizzleSink(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): Sink | null {
  // Must be a method call
  if (node.callee.type !== 'MemberExpression') return null;
  if (node.callee.property.type !== 'Identifier') return null;
  
  const methodName = node.callee.property.name;
  
  // Detect query type by final method in chain
  if (methodName === 'where') {
    return handleWhereCall(node, taintedSources, authContextExpr);
  }
  
  if (methodName === 'values') {
    return handleValuesCall(node, taintedSources, authContextExpr);
  }
  
  return null;
}

/**
 * Handles .where() calls for SELECT, UPDATE, DELETE queries.
 *
 * Walks backwards through call chain to determine operation type and extract table.
 */
function handleWhereCall(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): Sink | null {
  // Extract table name and operation from call chain
  const chainInfo = analyzeCallChain(node);
  if (!chainInfo) return null;
  
  // Determine sink kind based on operation
  const sinkKind: SinkKind = chainInfo.operation === 'write' ? 'db-write' : 'db-filter';
  
  // Extract filter keys from where clause
  const whereFilterKeys = extractFilterKeysFromWhere(node, taintedSources, authContextExpr);
  
  // For UPDATE queries, also extract from .set() clause
  let setFilterKeys: FilterKey[] = [];
  if (chainInfo.operation === 'write' && chainInfo.setNode) {
    setFilterKeys = extractFilterKeysFromSet(chainInfo.setNode, taintedSources, authContextExpr);
  }
  
  return {
    kind: sinkKind,
    operation: chainInfo.operation,
    model: chainInfo.tableName,
    filterKeys: [...whereFilterKeys, ...setFilterKeys],
    node,
  };
}

/**
 * Handles .values() calls for INSERT queries.
 */
function handleValuesCall(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): Sink | null {
  // Extract table name from db.insert(table) in chain
  const tableName = extractTableFromInsertChain(node);
  if (!tableName) return null;
  
  // Extract filter keys from values object
  const filterKeys = extractFilterKeysFromValues(node, taintedSources, authContextExpr);
  
  return {
    kind: 'db-write',
    operation: 'write',
    model: tableName,
    filterKeys,
    node,
  };
}

/**
 * Analyzes the call chain to extract table name, operation type, and .set() node.
 *
 * Walks backwards from .where() through the chain:
 * - .where() ← current
 * - .set() ← UPDATE only
 * - .from() ← SELECT/DELETE
 * - db.select()/db.update()/db.delete() ← root
 *
 * @returns { tableName, operation, setNode? } or null
 */
function analyzeCallChain(whereNode: TSESTree.CallExpression): {
  tableName: string;
  operation: DbOperation;
  setNode?: TSESTree.CallExpression;
} | null {
  if (whereNode.callee.type !== 'MemberExpression') return null;
  
  let current: TSESTree.Node = whereNode.callee.object;
  let setNode: TSESTree.CallExpression | undefined;
  let tableName: string | null = null;
  let operation: DbOperation | null = null;
  
  // Walk backwards through the chain
  while (current.type === 'CallExpression') {
    if (current.callee.type !== 'MemberExpression') break;
    if (current.callee.property.type !== 'Identifier') break;
    
    const methodName = current.callee.property.name;
    
    // Check for .set() (UPDATE only)
    if (methodName === 'set') {
      setNode = current;
      current = current.callee.object;
      continue;
    }
    
    // Check for .from() (SELECT/DELETE)
    if (methodName === 'from') {
      tableName = extractTableFromArguments(current.arguments);
      current = current.callee.object;
      continue;
    }
    
    // Check for db.select(), db.update(), db.delete()
    if (current.callee.object.type === 'Identifier' && current.callee.object.name === 'db') {
      const rootMethod = methodName;
      
      if (rootMethod === 'select') {
        operation = 'read';
      } else if (rootMethod === 'update') {
        operation = 'write';
        // For UPDATE, table is in db.update(table) argument
        if (!tableName) {
          tableName = extractTableFromArguments(current.arguments);
        }
      } else if (rootMethod === 'delete') {
        operation = 'delete';
      }
      
      break;
    }
    
    current = current.callee.object;
  }
  
  if (!tableName || !operation) return null;
  
  return { tableName, operation, setNode };
}

/**
 * Extracts table name from function arguments.
 *
 * Handles: .from(orders), db.update(orders)
 * Returns the identifier name or null.
 */
function extractTableFromArguments(args: TSESTree.CallExpressionArgument[]): string | null {
  if (args.length === 0) return null;
  const firstArg = args[0];
  if (firstArg.type === 'Identifier') {
    return firstArg.name;
  }
  return null;
}

/**
 * Extracts table name from INSERT chain: db.insert(table).values(...)
 */
function extractTableFromInsertChain(valuesNode: TSESTree.CallExpression): string | null {
  if (valuesNode.callee.type !== 'MemberExpression') return null;
  
  const insertCall = valuesNode.callee.object;
  if (insertCall.type !== 'CallExpression') return null;
  if (insertCall.callee.type !== 'MemberExpression') return null;
  if (insertCall.callee.property.type !== 'Identifier') return null;
  if (insertCall.callee.property.name !== 'insert') return null;
  
  // Check for db.insert pattern
  if (insertCall.callee.object.type !== 'Identifier') return null;
  if (insertCall.callee.object.name !== 'db') return null;
  
  return extractTableFromArguments(insertCall.arguments);
}

/**
 * Extracts filter keys from .where() clause.
 *
 * Parses Drizzle helper functions: eq(), and(), or(), ne(), etc.
 *
 * @example
 * .where(eq(orders.id, id))
 * → [{ key: 'id', valueKind: 'tainted', ... }]
 *
 * @example
 * .where(and(eq(orders.id, id), eq(orders.userId, user.id)))
 * → [{ key: 'id', ... }, { key: 'userId', ... }]
 */
function extractFilterKeysFromWhere(
  whereNode: TSESTree.CallExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): FilterKey[] {
  if (whereNode.arguments.length === 0) return [];
  
  const whereArg = whereNode.arguments[0];
  if (whereArg.type !== 'CallExpression') return [];
  
  return parseWhereHelper(whereArg, taintedSources, authContextExpr);
}

/**
 * Parses Drizzle where helper functions recursively.
 *
 * Handles:
 * - eq(column, value) → single FilterKey
 * - and([...]) → flatten array
 * - or([...]) → flatten array
 * - ne(), gt(), lt(), gte(), lte() → same as eq()
 */
function parseWhereHelper(
  helperCall: TSESTree.CallExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): FilterKey[] {
  if (helperCall.callee.type !== 'Identifier') return [];
  
  const helperName = helperCall.callee.name;
  
  // Handle and() / or() - these take an array of conditions
  if (helperName === 'and' || helperName === 'or') {
    if (helperCall.arguments.length === 0) return [];
    const firstArg = helperCall.arguments[0];
    
    // and([...]) or or([...])
    if (firstArg.type === 'ArrayExpression') {
      const filterKeys: FilterKey[] = [];
      for (const elem of firstArg.elements) {
        if (elem?.type === 'CallExpression') {
          filterKeys.push(...parseWhereHelper(elem, taintedSources, authContextExpr));
        }
      }
      return filterKeys;
    }
    
    return [];
  }
  
  // Handle comparison operators: eq(), ne(), gt(), lt(), gte(), lte()
  const comparisonOps = ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'like', 'ilike'];
  if (!comparisonOps.includes(helperName)) return [];
  
  // Must have 2 arguments: (column, value)
  if (helperCall.arguments.length < 2) return [];
  
  const columnArg = helperCall.arguments[0];
  const valueArg = helperCall.arguments[1];
  
  // Extract column name from table.column pattern
  const columnName = extractColumnName(columnArg);
  if (!columnName) return [];
  
  // Classify value kind
  const valueKind = classifyValueKind(valueArg, taintedSources, authContextExpr);
  const taintSource = findTaintSource(valueArg, taintedSources);
  
  return [{
    key: columnName,
    valueKind,
    taintSource,
    node: valueArg,
  }];
}

/**
 * Extracts column name from MemberExpression: orders.id → 'id'
 */
function extractColumnName(node: TSESTree.Node): string | null {
  if (node.type === 'MemberExpression') {
    if (node.property.type === 'Identifier') {
      return node.property.name;
    }
  }
  return null;
}

/**
 * Extracts filter keys from .set() clause.
 *
 * @example
 * .set({ status, updatedAt: new Date() })
 * → [{ key: 'status', valueKind: 'tainted' }, { key: 'updatedAt', valueKind: 'unknown' }]
 */
function extractFilterKeysFromSet(
  setNode: TSESTree.CallExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): FilterKey[] {
  if (setNode.arguments.length === 0) return [];
  
  const setArg = setNode.arguments[0];
  if (setArg.type !== 'ObjectExpression') return [];
  
  return extractFromObjectExpression(setArg, taintedSources, authContextExpr);
}

/**
 * Extracts filter keys from .values() clause.
 *
 * @example
 * .values({ name, email })
 * → [{ key: 'name', valueKind: 'tainted' }, { key: 'email', valueKind: 'tainted' }]
 */
function extractFilterKeysFromValues(
  valuesNode: TSESTree.CallExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): FilterKey[] {
  if (valuesNode.arguments.length === 0) return [];
  
  const valuesArg = valuesNode.arguments[0];
  if (valuesArg.type !== 'ObjectExpression') return [];
  
  return extractFromObjectExpression(valuesArg, taintedSources, authContextExpr);
}

/**
 * Extracts filter keys from an ObjectExpression.
 *
 * Handles both regular and shorthand properties.
 */
function extractFromObjectExpression(
  obj: TSESTree.ObjectExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): FilterKey[] {
  const filterKeys: FilterKey[] = [];
  
  for (const prop of obj.properties) {
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
  valueNode: TSESTree.Node,
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
  valueNode: TSESTree.Node,
  taintedSources: TaintedSource[]
): TaintedSource | undefined {
  if (valueNode.type !== 'Identifier') return undefined;
  return taintedSources.find(s => s.localName === valueNode.name);
}

// Made with Bob