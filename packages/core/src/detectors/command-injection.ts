/**
 * Command Injection Sink Detector
 *
 * Detects tainted input reaching a shell:
 *   exec(taintedCmd), execSync(taintedCmd)
 *   spawn('sh', ['-c', taintedCmd])
 *   spawn(cmd, args, { shell: true })
 *
 * Safe: execFile(file, [args]) / spawn(cmd, [args]) without a shell —
 * arguments are passed as an array and never reach a shell interpreter.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Sink, TaintedSource } from '../ir/types';
import { traceTaint, walkNode } from '../taint';

const SHELLS = ['sh', 'bash', 'zsh', 'fish', '/bin/sh', '/bin/bash', '/bin/zsh'];

/**
 * Detects command injection sinks in a route handler body.
 *
 * @param handlerNode - The route handler function
 * @param taintedSources - User-controlled sources in scope
 * @returns Sinks with kind 'shell-exec'
 */
export function detectCommandInjectionSinks(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  taintedSources: TaintedSource[]
): Sink[] {
  const sinks: Sink[] = [];
  if (handlerNode.body.type !== 'BlockStatement') return sinks;

  walkNode(handlerNode.body, (node) => {
    if (node.type !== 'CallExpression') return;
    const sink = detectCommandCall(node, taintedSources);
    if (sink) sinks.push(sink);
  });

  return sinks;
}

/** Resolves the callee name for `exec(...)` and `cp.exec(...)` alike. */
function calleeName(node: TSESTree.CallExpression): string | null {
  if (node.callee.type === 'Identifier') return node.callee.name;
  if (
    node.callee.type === 'MemberExpression' &&
    node.callee.property.type === 'Identifier'
  ) {
    return node.callee.property.name;
  }
  return null;
}

function detectCommandCall(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  const name = calleeName(node);
  if (!name) return null;

  // exec / execSync run their first argument through a shell.
  if (name === 'exec' || name === 'execSync') {
    const cmdArg = node.arguments[0];
    if (!cmdArg) return null;
    const taint = traceTaint(cmdArg, taintedSources);
    if (!taint) return null;
    return shellSink(node, 0, taint, cmdArg);
  }

  // spawn is only dangerous when it invokes a shell.
  if (name === 'spawn') return detectSpawnWithShell(node, taintedSources);

  // execFile / execFileSync without a shell are safe — not flagged.
  return null;
}

/** spawn('sh', ['-c', tainted]) or spawn(cmd, args, { shell: true }). */
function detectSpawnWithShell(
  node: TSESTree.CallExpression,
  taintedSources: TaintedSource[]
): Sink | null {
  const [first, second, third] = node.arguments;
  if (!first || !second) return null;

  // spawn('sh', ['-c', tainted])
  if (
    first.type === 'Literal' &&
    typeof first.value === 'string' &&
    SHELLS.includes(first.value) &&
    second.type === 'ArrayExpression'
  ) {
    for (const elem of second.elements) {
      if (!elem) continue;
      const taint = traceTaint(elem, taintedSources);
      if (taint) return shellSink(node, 1, taint, elem);
    }
  }

  // spawn(cmd, args, { shell: true })
  if (third && third.type === 'ObjectExpression' && hasShellTrue(third)) {
    const firstTaint = traceTaint(first, taintedSources);
    if (firstTaint) return shellSink(node, 0, firstTaint, first);
    if (second.type === 'ArrayExpression') {
      for (const elem of second.elements) {
        if (!elem) continue;
        const taint = traceTaint(elem, taintedSources);
        if (taint) return shellSink(node, 1, taint, elem);
      }
    }
  }

  return null;
}

function hasShellTrue(obj: TSESTree.ObjectExpression): boolean {
  return obj.properties.some(
    (prop) =>
      prop.type === 'Property' &&
      prop.key.type === 'Identifier' &&
      prop.key.name === 'shell' &&
      prop.value.type === 'Literal' &&
      prop.value.value === true
  );
}

function shellSink(
  call: TSESTree.CallExpression,
  argIndex: number,
  taintSource: TaintedSource,
  node: TSESTree.Node
): Sink {
  return { kind: 'shell-exec', node: call, taintedArg: { argIndex, taintSource, node } };
}
