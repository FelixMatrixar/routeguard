/**
 * Fastify Framework Adapter
 *
 * Converts Fastify AST patterns into Universal IR Route[].
 * Follows Express adapter pattern with Fastify-specific differences.
 *
 * Supported:
 *   fastify.get('/path', handler)
 *   fastify.post('/path', { schema }, handler)
 *   fastify.route({ method: 'GET', url: '/path', handler })
 *
 * Out of scope (v1): preHandler hooks, onRequest hooks, nested plugins
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { HttpMethod, TaintedSource, AuthContextRef } from '@routeguard/core';

/**
 * Detects Fastify route registration calls.
 *
 * Matches:
 * - fastify.get('/path', handler)
 * - fastify.post('/users', { schema }, handler)
 * - fastify.route({ method: 'GET', url: '/path', handler })
 *
 * Does NOT match:
 * - fastify.register(), fastify.listen()
 * - someObj.get() where first arg isn't a string
 * - route() calls without method/url properties
 *
 * @example
 * fastify.get('/orders/:id', async (request, reply) => { ... })
 * fastify.post('/users', { schema }, (request, reply) => { ... })
 * fastify.route({ method: 'GET', url: '/orders/:id', handler: async (request, reply) => { ... } })
 */
export function detectRouteCall(
  node: TSESTree.CallExpression
): { method: HttpMethod; path: string } | null {
  // Must be: someObj.method(...)
  if (node.callee.type !== 'MemberExpression') return null;
  if (node.callee.property.type !== 'Identifier') return null;
  
  const methodName = node.callee.property.name;
  
  // Pattern 1 & 2: fastify.get('/path', ...) or fastify.post('/path', { options }, handler)
  if (['get', 'post', 'put', 'patch', 'delete'].includes(methodName.toLowerCase())) {
    // First argument must be a string literal path
    if (node.arguments.length < 2) return null;
    const firstArg = node.arguments[0];
    if (firstArg.type !== 'Literal') return null;
    if (typeof firstArg.value !== 'string') return null;
    
    return {
      method: methodName.toUpperCase() as HttpMethod,
      path: firstArg.value,
    };
  }
  
  // Pattern 3: fastify.route({ method: 'GET', url: '/path', handler })
  if (methodName === 'route') {
    if (node.arguments.length < 1) return null;
    const firstArg = node.arguments[0];
    if (firstArg.type !== 'ObjectExpression') return null;
    
    let method: string | null = null;
    let url: string | null = null;
    
    for (const prop of firstArg.properties) {
      if (prop.type !== 'Property') continue;
      if (prop.key.type !== 'Identifier') continue;
      
      if (prop.key.name === 'method' && prop.value.type === 'Literal') {
        if (typeof prop.value.value === 'string') {
          method = prop.value.value.toUpperCase();
        }
      }
      
      if (prop.key.name === 'url' && prop.value.type === 'Literal') {
        if (typeof prop.value.value === 'string') {
          url = prop.value.value;
        }
      }
    }
    
    if (!method || !url) return null;
    
    const validMethods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    if (!validMethods.includes(method as HttpMethod)) return null;
    
    return {
      method: method as HttpMethod,
      path: url,
    };
  }
  
  return null;
}

/**
 * Extracts tainted sources from handler function body.
 *
 * Finds patterns:
 * - const { id } = request.params → route-param
 * - const { search } = request.query → query-param
 * - const { email } = request.body → body-field
 * - const id = request.params.id → route-param (direct access)
 *
 * @example
 * async (request, reply) => {
 *   const { id } = request.params;        // ← route-param: id
 *   const { search } = request.query;     // ← query-param: search
 *   const { email } = request.body;       // ← body-field: email
 * }
 */
export function extractTaintedSources(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  requestParamName: string
): TaintedSource[] {
  const sources: TaintedSource[] = [];
  
  // Handler body must be a block statement
  if (handlerNode.body.type !== 'BlockStatement') return sources;
  
  for (const stmt of handlerNode.body.body) {
    if (stmt.type !== 'VariableDeclaration') continue;
    
    for (const decl of stmt.declarations) {
      if (!decl.init) continue;
      
      // Pattern 1: const { id } = request.params
      if (decl.id.type === 'ObjectPattern' && decl.init.type === 'MemberExpression') {
        const sourceKind = getSourceKind(decl.init, requestParamName);
        if (!sourceKind) continue;
        
        // Extract each destructured property
        for (const prop of decl.id.properties) {
          if (prop.type !== 'Property') continue;
          if (prop.key.type !== 'Identifier') continue;
          if (prop.value.type !== 'Identifier') continue;
          
          sources.push({
            kind: sourceKind,
            localName: prop.value.name,
            requestKey: prop.key.name,
            node: prop.value,
          });
        }
      }
      
      // Pattern 2: const id = request.params.id
      if (decl.id.type === 'Identifier' && decl.init.type === 'MemberExpression') {
        const parent = decl.init;
        if (parent.object.type !== 'MemberExpression') continue;
        
        const sourceKind = getSourceKind(parent.object, requestParamName);
        if (!sourceKind) continue;
        if (parent.property.type !== 'Identifier') continue;
        
        sources.push({
          kind: sourceKind,
          localName: decl.id.name,
          requestKey: parent.property.name,
          node: decl.id,
        });
      }
    }
  }
  
  return sources;
}

/**
 * Helper: Determines if a MemberExpression is request.params/query/body.
 *
 * Matches: request.params, request.query, request.body
 * Does NOT match: request.user, params.id, other.params
 */
function getSourceKind(
  node: TSESTree.MemberExpression,
  requestParamName: string
): TaintedSource['kind'] | null {
  if (node.object.type !== 'Identifier') return null;
  if (node.object.name !== requestParamName) return null;
  if (node.property.type !== 'Identifier') return null;
  
  switch (node.property.name) {
    case 'params':
      return 'route-param';
    case 'query':
      return 'query-param';
    case 'body':
      return 'body-field';
    default:
      return null;
  }
}

/**
 * Extracts authenticated user context reference.
 *
 * Finds: request.user.id (or configured equivalent like request.session.userId)
 *
 * @example
 * // With default config { property: 'user', idField: 'id' }
 * async (request, reply) => {
 *   const userId = request.user.id;  // ← matches
 * }
 *
 * // With custom config { property: 'session', idField: 'userId' }
 * async (request, reply) => {
 *   const id = request.session.userId;  // ← matches
 * }
 */
export function extractAuthContext(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  requestParamName: string,
  authConfig: { property: string; idField: string }
): AuthContextRef | null {
  // Handler body must be a block statement
  if (handlerNode.body.type !== 'BlockStatement') return null;
  
  for (const stmt of handlerNode.body.body) {
    // Look for any expression or variable declaration
    let expr: TSESTree.Expression | null = null;
    
    if (stmt.type === 'ExpressionStatement') {
      expr = stmt.expression;
    } else if (stmt.type === 'VariableDeclaration') {
      for (const decl of stmt.declarations) {
        if (decl.init) {
          expr = decl.init as TSESTree.Expression;
          break;
        }
      }
    }
    
    if (!expr) continue;
    
    // Walk the expression tree looking for request.user.id pattern
    const authRef = findAuthContextInExpression(expr, requestParamName, authConfig);
    if (authRef) return authRef;
  }
  
  return null;
}

/**
 * Recursively searches an expression for auth context pattern.
 *
 * Matches: request.user.id, request.session.userId (based on config)
 */
function findAuthContextInExpression(
  node: TSESTree.Node,
  requestParamName: string,
  authConfig: { property: string; idField: string }
): AuthContextRef | null {
  // Pattern: request.user.id
  // MemberExpression { object: MemberExpression { object: Identifier(request), property: Identifier(user) }, property: Identifier(id) }
  if (node.type === 'MemberExpression') {
    if (node.object.type === 'MemberExpression') {
      const innerObj = node.object;
      
      // Check: request.user.id
      if (innerObj.object.type === 'Identifier' &&
          innerObj.object.name === requestParamName &&
          innerObj.property.type === 'Identifier' &&
          innerObj.property.name === authConfig.property &&
          node.property.type === 'Identifier' &&
          node.property.name === authConfig.idField) {
        
        return {
          expression: `${requestParamName}.${authConfig.property}.${authConfig.idField}`,
          node: node,
        };
      }
    }
    
    // Recursively check nested expressions
    const fromObject = findAuthContextInExpression(node.object, requestParamName, authConfig);
    if (fromObject) return fromObject;
    
    if (node.property.type !== 'Literal') {
      const fromProperty = findAuthContextInExpression(node.property, requestParamName, authConfig);
      if (fromProperty) return fromProperty;
    }
  }
  
  // Check other expression types that might contain member expressions
  if (node.type === 'CallExpression') {
    for (const arg of node.arguments) {
      const found = findAuthContextInExpression(arg, requestParamName, authConfig);
      if (found) return found;
    }
  }
  
  if (node.type === 'ObjectExpression') {
    for (const prop of node.properties) {
      if (prop.type === 'Property') {
        const found = findAuthContextInExpression(prop.value, requestParamName, authConfig);
        if (found) return found;
      }
    }
  }
  
  if (node.type === 'ArrayExpression') {
    for (const elem of node.elements) {
      if (elem) {
        const found = findAuthContextInExpression(elem, requestParamName, authConfig);
        if (found) return found;
      }
    }
  }
  
  return null;
}

// Made with Bob
