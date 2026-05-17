/**
 * Factory that creates an ESLint Rule.RuleModule for a single SinkKind.
 *
 * Every per-rule module (no-bola, no-ssrf, …) is just makeRule(<sinkKind>).
 * All eight rules share the same analyzeProgram call via the WeakMap cache in
 * shared.ts, so the full pipeline only runs once per file regardless of how
 * many rules are enabled.
 */

import type { Rule } from 'eslint';
import type { TSESTree } from '@typescript-eslint/utils';
import type { SinkKind, RouteGuardConfig } from '@routeguard/core';
import { getCachedFindings } from './shared';

export function makeRule(sinkKind: SinkKind): Rule.RuleModule {
  return {
    meta: {
      type: 'problem',
      docs: { recommended: true },
      schema: [{ type: 'object', additionalProperties: true }],
    },
    create(context) {
      return {
        'Program:exit'(program) {
          const filename = context.filename ?? context.getFilename();
          const options = (context.options[0] ?? {}) as Partial<RouteGuardConfig>;
          const findings = getCachedFindings(
            program as unknown as TSESTree.Program,
            filename,
            options
          );
          for (const finding of findings) {
            if (finding.sink.kind !== sinkKind) continue;
            context.report({
              node: finding.sink.node as unknown as Rule.Node,
              message: finding.message,
            });
          }
        },
      };
    },
  };
}
