/**
 * Express Framework Adapter — Reference Implementation
 *
 * Converts Express AST patterns into Universal IR Route[].
 * All other adapters follow this pattern.
 *
 * Supported:
 *   app.get('/path', handler)
 *   app.post('/path', middleware, handler)
 *   router.delete('/path/:id', handler)
 *
 * Out of scope (v1): app.use() chains, Router.param(), nested routers
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { HttpMethod, TaintedSource, AuthContextRef } from '@routeguard/core';

/**
 * Detects Express route registration calls.
 *
 * Matches: app.get('/path', handler), router.post('/users', auth, handler)
 * Does NOT match: app.use(), app.listen(), someObj.get() where first arg isn't a string
 *
 * @example
 * app.get('/orders/:id', async (req, res) => { ... })
 * router.post('/users', authenticate, (req, res) => { ... })
 */
export function detectRouteCall(
  node: TSESTree.CallExpression
): { method: HttpMethod; path: string } | null {
  // Must be: someObj.method(...)
  if (node.callee.type !== 'MemberExpression') return null;
  if (node.callee.property.type !== 'Identifier') return null;
  
  // Method name must be a HTTP verb
  const methodName = node.callee.property.name.toUpperCase();
  const validMethods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  if (!validMethods.includes(methodName as HttpMethod)) return null;
  
  // First argument must be a string literal path
  if (node.arguments.length < 2) return null;
  const firstArg = node.arguments[0];
  if (firstArg.type !== 'Literal') return null;
  if (typeof firstArg.value !== 'string') return null;
  
  return {
    method: methodName as HttpMethod,
    path: firstArg.value,
  };
}

/**
 * Extracts tainted sources from handler function body.
 *
 * Finds patterns:
 * - const { id } = req.params → route-param
 * - const { search } = req.query → query-param
 * - const { email } = req.body → body-field
 * - const id = req.params.id → route-param (direct access)
 *
 * @example
 * async (req, res) => {
 *   const { id } = req.params;        // ← route-param: id
 *   const { search } = req.query;     // ← query-param: search
 *   const { email } = req.body;       // ← body-field: email
 * }
 */
export function extractTaintedSources(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  reqParamName: string
): TaintedSource[] {
  const sources: TaintedSource[] = [];
  
  // Handler body must be a block statement
  if (handlerNode.body.type !== 'BlockStatement') return sources;
  
  for (const stmt of handlerNode.body.body) {
    if (stmt.type !== 'VariableDeclaration') continue;
    
    for (const decl of stmt.declarations) {
      if (!decl.init) continue;
      
      // Pattern 1: const { id } = req.params
      if (decl.id.type === 'ObjectPattern' && decl.init.type === 'MemberExpression') {
        const sourceKind = getSourceKind(decl.init, reqParamName);
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
      
      // Pattern 2: const id = req.params.id
      if (decl.id.type === 'Identifier' && decl.init.type === 'MemberExpression') {
        const parent = decl.init;
        if (parent.object.type !== 'MemberExpression') continue;
        
        const sourceKind = getSourceKind(parent.object, reqParamName);
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
 * Helper: Determines if a MemberExpression is req.params/query/body.
 *
 * Matches: req.params, req.query, req.body
 * Does NOT match: req.user, params.id, other.params
 */
function getSourceKind(
  node: TSESTree.MemberExpression,
  reqParamName: string
): TaintedSource['kind'] | null {
  if (node.object.type !== 'Identifier') return null;
  if (node.object.name !== reqParamName) return null;
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
 * Finds: req.user.id (or configured equivalent like req.session.userId)
 *
 * @example
 * // With default config { property: 'user', idField: 'id' }
 * async (req, res) => {
 *   const userId = req.user.id;  // ← matches
 * }
 *
 * // With custom config { property: 'session', idField: 'userId' }
 * async (req, res) => {
 *   const id = req.session.userId;  // ← matches
 * }
 */
export function extractAuthContext(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  reqParamName: string,
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
    
    // Walk the expression tree looking for req.user.id pattern
    const authRef = findAuthContextInExpression(expr, reqParamName, authConfig);
    if (authRef) return authRef;
  }
  
  return null;
}

/**
 * Recursively searches an expression for auth context pattern.
 *
 * Matches: req.user.id, req.session.userId (based on config)
 */
function findAuthContextInExpression(
  node: TSESTree.Node,
  reqParamName: string,
  authConfig: { property: string; idField: string }
): AuthContextRef | null {
  // Pattern: req.user.id
  // MemberExpression { object: MemberExpression { object: Identifier(req), property: Identifier(user) }, property: Identifier(id) }
  if (node.type === 'MemberExpression') {
    if (node.object.type === 'MemberExpression') {
      const innerObj = node.object;
      
      // Check: req.user.id
      if (innerObj.object.type === 'Identifier' &&
          innerObj.object.name === reqParamName &&
          innerObj.property.type === 'Identifier' &&
          innerObj.property.name === authConfig.property &&
          node.property.type === 'Identifier' &&
          node.property.name === authConfig.idField) {
        
        return {
          expression: `${reqParamName}.${authConfig.property}.${authConfig.idField}`,
          node: node,
        };
      }
    }
    
    // Recursively check nested expressions
    const fromObject = findAuthContextInExpression(node.object, reqParamName, authConfig);
    if (fromObject) return fromObject;
    
    if (node.property.type !== 'Literal') {
      const fromProperty = findAuthContextInExpression(node.property, reqParamName, authConfig);
      if (fromProperty) return fromProperty;
    }
  }
  
  // Check other expression types that might contain member expressions
  if (node.type === 'CallExpression') {
    for (const arg of node.arguments) {
      const found = findAuthContextInExpression(arg, reqParamName, authConfig);
      if (found) return found;
    }
  }
  
  if (node.type === 'ObjectExpression') {
    for (const prop of node.properties) {
      if (prop.type === 'Property') {
        const found = findAuthContextInExpression(prop.value, reqParamName, authConfig);
        if (found) return found;
      }
    }
  }
  
  if (node.type === 'ArrayExpression') {
    for (const elem of node.elements) {
      if (elem) {
        const found = findAuthContextInExpression(elem, reqParamName, authConfig);
        if (found) return found;
      }
    }
  }
  
  return null;
}

// Made with Bob
