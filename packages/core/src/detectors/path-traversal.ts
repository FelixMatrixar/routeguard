/**
 * Path Traversal Sink Detector
 *
 * Detects tainted paths in filesystem operations:
 *   fs.readFile(`./uploads/${req.params.file}`)
 *   fs.createReadStream(path.join('./uploads', req.query.file))
 *
 * Safe: the tainted value is wrapped in path.basename() before the fs call.
 * A basename() wrapper is a CallExpression, which taint tracing never
 * descends into — so wrapped values are not reported.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Sink, TaintedSource } from '../ir/types';
import { traceTaint, walkNode } from '../taint';

const FS_OPERATIONS = new Set([
  'readFile', 'readFileSync', 'writeFile', 'writeFileSync',
  'appendFile', 'appendFileSync', 'createReadStream', 'createWriteStream',
  'unlink', 'unlinkSync', 'rmdir', 'rmdirSync', 'mkdir', 'mkdirSync',
  'readdir', 'readdirSync', 'stat', 'statSync', 'access', 'accessSync',
  'open', 'openSync', 'chmod', 'chmodSync', 'chown', 'chownSync',
]);

/**
 * Detects path traversal sinks in a route handler body.
 *
 * @param handlerNode - The route handler function
 * @param taintedSources - User-controlled sources in scope
 * @returns Sinks with kind 'fs-path'
 */
export function detectPathTraversalSinks(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  taintedSources: TaintedSource[]
): Sink[] {
  const sinks: Sink[] = [];
  if (handlerNode.body.type !== 'BlockStatement') return sinks;

  walkNode(handlerNode.body, (node) => {
    if (node.type !== 'CallExpression') return;
    const sink = detectFileSystemCall(node, taintedSources);
    if (sink) sinks.push(sink);
  });

  return sinks;
}

/** fs.<op>(taintedPath, ...) */
function detectFileSystemCall(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  if (
    node.callee.type !== 'MemberExpression' ||
    node.callee.object.type !== 'Identifier' ||
    node.callee.object.name !== 'fs' ||
    node.callee.property.type !== 'Identifier' ||
    !FS_OPERATIONS.has(node.callee.property.name)
  ) {
    return null;
  }

  const pathArg = node.arguments[0];
  if (!pathArg) return null;

  const found = findTaintInPath(pathArg, taintedSources);
  if (!found) return null;

  return {
    kind: 'fs-path',
    node,
    taintedArg: { argIndex: 0, taintSource: found.source, node: found.node },
  };
}

/** Traces taint through a path argument, including path.join() arguments. */
function findTaintInPath(
  pathArg: TSESTree.Node,
  taintedSources: TaintedSource[]
): { node: TSESTree.Node; source: TaintedSource } | null {
  if (pathArg.type === 'CallExpression' && isPathJoinCall(pathArg)) {
    for (const arg of pathArg.arguments) {
      const source = traceTaint(arg, taintedSources);
      if (source) return { node: arg, source };
    }
    return null;
  }

  const source = traceTaint(pathArg, taintedSources);
  return source ? { node: pathArg, source } : null;
}

/** Matches path.join(...). */
function isPathJoinCall(node: TSESTree.CallExpression): boolean {
  return (
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'path' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'join'
  );
}
