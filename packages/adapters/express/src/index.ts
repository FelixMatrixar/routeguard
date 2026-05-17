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
 *
 * TODO (use ast-explorer mode in Bob):
 *   Implement detectRouteCall, extractTaintedSources, extractAuthContext
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Route } from '@routeguard/core';

/** Matches: app.get('/path', handler) → { method: 'GET', path: '/path' } */
export function detectRouteCall(
  _node: TSESTree.CallExpression
): { method: Route['method']; path: string } | null {
  // TODO: implement
  return null;
}

/** Walks handler body, collects req.params.X / req.query.X / req.body.X */
export function extractTaintedSources(
  _handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  _reqParamName: string
): Route['taintedSources'] {
  // TODO: implement
  return [];
}

/** Finds req.user.id (or configured equivalent) in handler body */
export function extractAuthContext(
  _handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  _reqParamName: string,
  _authConfig: { property: string; idField: string }
): Route['authContext'] {
  // TODO: implement
  return null;
}
