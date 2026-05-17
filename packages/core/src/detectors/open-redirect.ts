/**
 * Open Redirect Sink Detector
 *
 * Detects tainted URLs in redirect calls:
 *   res.redirect(req.query.returnUrl)
 *   res.redirect(301, req.params.url)
 *   reply.redirect(req.query.url) (Fastify)
 *
 * Safe: a literal redirect target, or a value validated against an
 * allowlist before the call (allowlist validation is not modelled in v1).
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Sink, TaintedSource } from '../ir/types';
import { traceTaint, walkNode } from '../taint';

const REDIRECT_RECEIVERS = ['res', 'reply', 'response'];

/**
 * Detects open redirect sinks in a route handler body.
 *
 * @param handlerNode - The route handler function
 * @param taintedSources - User-controlled sources in scope
 * @returns Sinks with kind 'redirect-url'
 */
export function detectOpenRedirectSinks(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  taintedSources: TaintedSource[]
): Sink[] {
  const sinks: Sink[] = [];
  if (handlerNode.body.type !== 'BlockStatement') return sinks;

  walkNode(handlerNode.body, (node) => {
    if (node.type !== 'CallExpression') return;
    const sink = detectRedirectCall(node, taintedSources);
    if (sink) sinks.push(sink);
  });

  return sinks;
}

/** res.redirect(url) / res.redirect(statusCode, url) */
function detectRedirectCall(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  if (
    node.callee.type !== 'MemberExpression' ||
    node.callee.object.type !== 'Identifier' ||
    !REDIRECT_RECEIVERS.includes(node.callee.object.name) ||
    node.callee.property.type !== 'Identifier' ||
    node.callee.property.name !== 'redirect'
  ) {
    return null;
  }

  const urlArgIndex = resolveUrlArgIndex(node);
  if (urlArgIndex === null) return null;

  const urlArg = node.arguments[urlArgIndex];
  const taint = traceTaint(urlArg, taintedSources);
  if (!taint) return null;

  return {
    kind: 'redirect-url',
    node,
    taintedArg: { argIndex: urlArgIndex, taintSource: taint, node: urlArg },
  };
}

/**
 * The URL is the last argument. With the `(statusCode, url)` overload the
 * first argument is a numeric literal — the URL is then at index 1.
 */
function resolveUrlArgIndex(node: TSESTree.CallExpression): number | null {
  if (node.arguments.length === 1) return 0;
  if (node.arguments.length === 2) {
    const first = node.arguments[0];
    return first.type === 'Literal' && typeof first.value === 'number' ? 1 : 0;
  }
  return null;
}
