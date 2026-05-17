/**
 * SSRF (Server-Side Request Forgery) Sink Detector
 *
 * Detects tainted URLs reaching outbound HTTP requests:
 *   axios.get(taintedUrl), fetch(taintedUrl), got(taintedUrl),
 *   http.request({ hostname: taintedHost }), needle.get(taintedUrl)
 *
 * v1 scope: every tainted URL is flagged. Allowlist validation is not
 * recognised as a guard — that needs control-flow analysis. Precision here
 * comes from tight taint matching (see ../taint), not from guard detection.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Sink, TaintedSource } from '../ir/types';
import { traceTaint, walkNode } from '../taint';

const HTTP_LIBRARIES = ['axios', 'http', 'https', 'got', 'needle', 'superagent'];
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
const FETCH_FUNCTIONS = ['fetch', 'got', 'nodeFetch'];
const URL_OPTION_KEYS = ['hostname', 'host', 'url', 'uri', 'href'];

/**
 * Detects SSRF sinks in a route handler body.
 *
 * @param handlerNode - The route handler function
 * @param taintedSources - User-controlled sources in scope
 * @returns Sinks with kind 'outbound-url'
 */
export function detectSSRFSinks(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  taintedSources: TaintedSource[]
): Sink[] {
  const sinks: Sink[] = [];
  if (handlerNode.body.type !== 'BlockStatement') return sinks;

  walkNode(handlerNode.body, (node) => {
    if (node.type !== 'CallExpression') return;
    const sink = detectHTTPRequestCall(node, taintedSources);
    if (sink) sinks.push(sink);
  });

  return sinks;
}

/** axios.get(url), fetch(url), http.request({ hostname }), got(url), ... */
function detectHTTPRequestCall(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  // Pattern A: <lib>.<method>(...)
  if (
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'Identifier' &&
    node.callee.property.type === 'Identifier'
  ) {
    const lib = node.callee.object.name;
    const method = node.callee.property.name;
    if (!HTTP_LIBRARIES.includes(lib)) return null;

    if (HTTP_METHODS.includes(method) && node.arguments[0]) {
      return urlSink(node, node.arguments[0], taintedSources);
    }
    if (method === 'request' && node.arguments[0]) {
      return requestOptionsSink(node, node.arguments[0], taintedSources);
    }
    return null;
  }

  // Pattern B: fetch(url) / got(url)
  if (node.callee.type === 'Identifier' && FETCH_FUNCTIONS.includes(node.callee.name)) {
    if (!node.arguments[0]) return null;
    return urlSink(node, node.arguments[0], taintedSources);
  }

  return null;
}

/** Builds a sink if `urlArg` is tainted. */
function urlSink(
  call: TSESTree.CallExpression,
  urlArg: TSESTree.Node,
  taintedSources: TaintedSource[]
): Sink | null {
  const taint = traceTaint(urlArg, taintedSources);
  if (!taint) return null;
  return {
    kind: 'outbound-url',
    node: call,
    taintedArg: { argIndex: 0, taintSource: taint, node: urlArg },
  };
}

/** http.request({ hostname: tainted }) or http.request(taintedUrl). */
function requestOptionsSink(
  call: TSESTree.CallExpression,
  arg: TSESTree.Node,
  taintedSources: TaintedSource[]
): Sink | null {
  if (arg.type === 'ObjectExpression') {
    for (const prop of arg.properties) {
      if (prop.type !== 'Property' || prop.key.type !== 'Identifier') continue;
      if (!URL_OPTION_KEYS.includes(prop.key.name)) continue;
      const taint = traceTaint(prop.value, taintedSources);
      if (taint) {
        return {
          kind: 'outbound-url',
          node: call,
          taintedArg: { argIndex: 0, taintSource: taint, node: prop.value },
        };
      }
    }
    return null;
  }
  return urlSink(call, arg, taintedSources);
}
