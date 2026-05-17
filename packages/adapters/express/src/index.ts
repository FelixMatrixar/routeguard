/**
 * Express Framework Adapter — Reference Implementation
 *
 * Converts Express AST patterns into Universal IR Route[]. All other
 * framework adapters follow this structure.
 *
 * Supported:  app.get('/p', handler), router.post('/p', mw, handler)
 * Out of scope (v1): app.use() chains, Router.param(), nested routers,
 *                    taint sources declared inside nested callbacks.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { HttpMethod, TaintedSource, AuthContextRef, Route } from '@routeguard/core';
import { walkNode } from '@routeguard/core';

type HandlerFn = TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression;
type AuthConfig = { property: string; idField: string };

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Walks a Program and produces one Route per Express route registration.
 *
 * Routes carry taint sources and auth context but an empty `sinks` array —
 * the orchestrator fills sinks by running the ORM and sink detectors against
 * `handlerNode`.
 *
 * @example app.get('/orders/:id', authenticate, async (req, res) => { ... })
 */
export function extractRoutes(
  program: TSESTree.Program,
  authConfig: AuthConfig
): Route[] {
  const routes: Route[] = [];

  walkNode(program, (node) => {
    if (node.type !== 'CallExpression') return;
    const routeInfo = detectRouteCall(node);
    if (!routeInfo) return;

    const handler = findHandler(node);
    if (!handler) return;

    const reqParamName =
      handler.params[0]?.type === 'Identifier' ? handler.params[0].name : 'req';

    routes.push({
      framework: 'express',
      method: routeInfo.method,
      path: routeInfo.path,
      handlerNode: handler,
      taintedSources: extractTaintedSources(handler, reqParamName),
      authContext: extractAuthContext(handler, reqParamName, authConfig),
      sinks: [],
    });
  });

  return routes;
}

/** Returns the route handler — the last function argument of the call. */
function findHandler(node: TSESTree.CallExpression): HandlerFn | null {
  for (let i = node.arguments.length - 1; i >= 0; i--) {
    const arg = node.arguments[i];
    if (arg.type === 'FunctionExpression' || arg.type === 'ArrowFunctionExpression') {
      return arg;
    }
  }
  return null;
}

/**
 * Detects an Express route registration call.
 *
 * Matches:  app.get('/p', handler), router.post('/users', auth, handler)
 * Rejects:  app.use(), app.listen(), obj.get() whose first arg is not a string
 */
export function detectRouteCall(
  node: TSESTree.CallExpression
): { method: HttpMethod; path: string } | null {
  if (node.callee.type !== 'MemberExpression') return null;
  if (node.callee.property.type !== 'Identifier') return null;

  const method = node.callee.property.name.toUpperCase() as HttpMethod;
  if (!HTTP_METHODS.includes(method)) return null;

  if (node.arguments.length < 2) return null;
  const firstArg = node.arguments[0];
  if (firstArg.type !== 'Literal' || typeof firstArg.value !== 'string') return null;

  return { method, path: firstArg.value };
}

/**
 * Extracts tainted sources from the top level of a handler body.
 *
 * Matches:  const { id } = req.params   → route-param
 *           const id = req.params.id    → route-param
 *           const { q } = req.query     → query-param
 *           const { email } = req.body  → body-field
 *
 * v1 limitation: only the handler's own top-level statements are scanned.
 */
export function extractTaintedSources(
  handlerNode: HandlerFn,
  reqParamName: string
): TaintedSource[] {
  const sources: TaintedSource[] = [];
  if (handlerNode.body.type !== 'BlockStatement') return sources;

  for (const stmt of handlerNode.body.body) {
    if (stmt.type !== 'VariableDeclaration') continue;

    for (const decl of stmt.declarations) {
      if (!decl.init) continue;

      // const { id } = req.params
      if (decl.id.type === 'ObjectPattern' && decl.init.type === 'MemberExpression') {
        const kind = getSourceKind(decl.init, reqParamName);
        if (!kind) continue;
        for (const prop of decl.id.properties) {
          if (
            prop.type === 'Property' &&
            prop.key.type === 'Identifier' &&
            prop.value.type === 'Identifier'
          ) {
            sources.push({
              kind,
              localName: prop.value.name,
              requestKey: prop.key.name,
              node: prop.value,
            });
          }
        }
      }

      // const id = req.params.id
      if (
        decl.id.type === 'Identifier' &&
        decl.init.type === 'MemberExpression' &&
        decl.init.object.type === 'MemberExpression' &&
        decl.init.property.type === 'Identifier'
      ) {
        const kind = getSourceKind(decl.init.object, reqParamName);
        if (!kind) continue;
        sources.push({
          kind,
          localName: decl.id.name,
          requestKey: decl.init.property.name,
          node: decl.id,
        });
      }
    }
  }

  return sources;
}

/** Maps req.params / req.query / req.body to a taint source kind. */
function getSourceKind(
  node: TSESTree.MemberExpression,
  reqParamName: string
): TaintedSource['kind'] | null {
  if (node.object.type !== 'Identifier' || node.object.name !== reqParamName) return null;
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
 * Finds the authenticated-user reference anywhere in the handler.
 *
 * With default config { property: 'user', idField: 'id' } this matches
 * `req.user.id` — including inside `await` expressions and nested objects,
 * since the whole handler subtree is walked.
 */
export function extractAuthContext(
  handlerNode: HandlerFn,
  reqParamName: string,
  authConfig: AuthConfig
): AuthContextRef | null {
  let found: AuthContextRef | null = null;

  walkNode(handlerNode, (node) => {
    if (found) return;
    if (
      node.type === 'MemberExpression' &&
      node.object.type === 'MemberExpression' &&
      node.object.object.type === 'Identifier' &&
      node.object.object.name === reqParamName &&
      node.object.property.type === 'Identifier' &&
      node.object.property.name === authConfig.property &&
      node.property.type === 'Identifier' &&
      node.property.name === authConfig.idField
    ) {
      found = {
        expression: `${reqParamName}.${authConfig.property}.${authConfig.idField}`,
        node,
      };
    }
  });

  return found;
}
