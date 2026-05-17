/**
 * Shared analysis cache for all per-rule modules.
 *
 * Running analyzeProgram eight times on the same file would redo all the AST
 * walking, taint tracing, and sink detection for each rule. Instead we cache
 * the result keyed on the Program node reference — the reference is stable for
 * the lifetime of a single ESLint pass, and the WeakMap ensures it is GC'd
 * together with the node.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Finding, SinkKind, RouteGuardConfig } from '@routeguard/core';
import { analyzeProgram } from '../analyze';

const cache = new WeakMap<TSESTree.Program, Finding[]>();

export function getCachedFindings(
  program: TSESTree.Program,
  filename: string,
  options: Partial<RouteGuardConfig>
): Finding[] {
  const hit = cache.get(program);
  if (hit) return hit;
  const findings = analyzeProgram(program, filename, options);
  cache.set(program, findings);
  return findings;
}

/** Maps each SinkKind to the ESLint rule name that covers it. */
export const SINK_RULE: Record<SinkKind, string> = {
  'db-filter':        'no-bola',
  'db-write':         'no-mass-assignment',
  'outbound-url':     'no-ssrf',
  'raw-sql':          'no-sql-injection',
  'shell-exec':       'no-command-injection',
  'fs-path':          'no-path-traversal',
  'redirect-url':     'no-open-redirect',
  'hardcoded-secret': 'no-hardcoded-secrets',
};
