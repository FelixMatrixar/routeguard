/**
 * Fastify Framework Adapter
 *
 * Converts Fastify AST patterns into Universal IR Route[], following the
 * Express adapter structure.
 *
 * Supported:
 *   fastify.get('/p', handler)
 *   fastify.post('/p', { schema }, handler)
 *   fastify.route({ method: 'GET', url: '/p', handler })
 * Out of scope (v1): preHandler / onRequest hooks, nested plugins.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { HttpMethod, TaintedSource, AuthContextRef, Route } from '@routeguard/core';
import { walkNode } from '@routeguard/core';

type HandlerFn = TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression;
type AuthConfig = { property: string; idField: string };

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const METHOD_NAMES = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * Walks a Program and produces one Route per Fastify route registration.
 *
 * Routes carry an empty `sinks` array — the orchestrator fills it from the
 * ORM and sink detectors.
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
      handler.params[0]?.type === 'Identifier' ? handler.params[0].name : 'request';

    routes.push({
      framework: 'fastify',
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

/**
 * Returns the route handler. For `fastify.get(...)` it is the last function
 * argument; for `fastify.route({ handler })` it is the `handler` property.
 */
function findHandler(node: TSESTree.CallExpression): HandlerFn | null {
  for (let i = node.arguments.length - 1; i >= 0; i--) {
    const arg = node.arguments[i];
    if (arg.type === 'FunctionExpression' || arg.type === 'ArrowFunctionExpression') {
      return arg;
    }
    if (arg.type === 'ObjectExpression') {
      for (const prop of arg.properties) {
        if (
          prop.type === 'Property' &&
          prop.key.type === 'Identifier' &&
          prop.key.name === 'handler' &&
          (prop.value.type === 'FunctionExpression' ||
            prop.value.type === 'ArrowFunctionExpression')
        ) {
          return prop.value;
        }
      }
    }
  }
  return null;
}

/**
 * Detects a Fastify route registration call.
 *
 * Matches:  fastify.get('/p', handler), fastify.post('/p', { schema }, handler)
 *           fastify.route({ method: 'GET', url: '/p', handler })
 * Rejects:  fastify.register(), fastify.listen()
 */
export function detectRouteCall(
  node: TSESTree.CallExpression
): { method: HttpMethod; path: string } | null {
  if (node.callee.type !== 'MemberExpression') return null;
  if (node.callee.property.type !== 'Identifier') return null;

  const methodName = node.callee.property.name;

  // fastify.get('/p', ...)
  if (METHOD_NAMES.includes(methodName.toLowerCase())) {
    if (node.arguments.length < 2) return null;
    const firstArg = node.arguments[0];
    if (firstArg.type !== 'Literal' || typeof firstArg.value !== 'string') return null;
    return { method: methodName.toUpperCase() as HttpMethod, path: firstArg.value };
  }

  // fastify.route({ method, url, handler })
  if (methodName === 'route') {
    const firstArg = node.arguments[0];
    if (!firstArg || firstArg.type !== 'ObjectExpression') return null;

    let method: string | null = null;
    let url: string | null = null;
    for (const prop of firstArg.properties) {
      if (prop.type !== 'Property' || prop.key.type !== 'Identifier') continue;
      if (prop.value.type !== 'Literal' || typeof prop.value.value !== 'string') continue;
      if (prop.key.name === 'method') method = prop.value.value.toUpperCase();
      if (prop.key.name === 'url') url = prop.value.value;
    }

    if (!method || !url) return null;
    if (!HTTP_METHODS.includes(method as HttpMethod)) return null;
    return { method: method as HttpMethod, path: url };
  }

  return null;
}

/**
 * Extracts tainted sources from the top level of a handler body.
 *
 * Matches:  const { id } = request.params  → route-param
 *           const id = request.params.id   → route-param
 *           const { q } = request.query    → query-param
 *           const { email } = request.body → body-field
 */
export function extractTaintedSources(
  handlerNode: HandlerFn,
  requestParamName: string
): TaintedSource[] {
  const sources: TaintedSource[] = [];
  if (handlerNode.body.type !== 'BlockStatement') return sources;

  for (const stmt of handlerNode.body.body) {
    if (stmt.type !== 'VariableDeclaration') continue;

    for (const decl of stmt.declarations) {
      if (!decl.init) continue;

      if (decl.id.type === 'ObjectPattern' && decl.init.type === 'MemberExpression') {
        const kind = getSourceKind(decl.init, requestParamName);
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

      if (
        decl.id.type === 'Identifier' &&
        decl.init.type === 'MemberExpression' &&
        decl.init.object.type === 'MemberExpression' &&
        decl.init.property.type === 'Identifier'
      ) {
        const kind = getSourceKind(decl.init.object, requestParamName);
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

/** Maps request.params / request.query / request.body to a taint source kind. */
function getSourceKind(
  node: TSESTree.MemberExpression,
  requestParamName: string
): TaintedSource['kind'] | null {
  if (node.object.type !== 'Identifier' || node.object.name !== requestParamName) {
    return null;
  }
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
 * With default config this matches `request.user.id`.
 */
export function extractAuthContext(
  handlerNode: HandlerFn,
  requestParamName: string,
  authConfig: AuthConfig
): AuthContextRef | null {
  let found: AuthContextRef | null = null;

  walkNode(handlerNode, (node) => {
    if (found) return;
    if (
      node.type === 'MemberExpression' &&
      node.object.type === 'MemberExpression' &&
      node.object.object.type === 'Identifier' &&
      node.object.object.name === requestParamName &&
      node.object.property.type === 'Identifier' &&
      node.object.property.name === authConfig.property &&
      node.property.type === 'Identifier' &&
      node.property.name === authConfig.idField
    ) {
      found = {
        expression: `${requestParamName}.${authConfig.property}.${authConfig.idField}`,
        node,
      };
    }
  });

  return found;
}
