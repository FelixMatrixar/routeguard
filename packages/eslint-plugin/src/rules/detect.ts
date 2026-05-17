/**
 * ESLint rule: routeguard/detect-vulnerabilities
 *
 * Runs the full RouteGuard pipeline once per file (on `Program:exit`) and
 * reports every Finding the engine returns.
 */

import type { Rule } from 'eslint';
import type { TSESTree } from '@typescript-eslint/utils';
import type { RouteGuardConfig } from '@routeguard/core';
import { analyzeProgram } from '../analyze';

export const detectRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Detect API security vulnerabilities (BOLA, injection, SSRF, …) via taint analysis',
      recommended: true,
    },
    schema: [{ type: 'object', additionalProperties: true }],
  },
  create(context) {
    return {
      'Program:exit'(program) {
        const filename = context.filename ?? context.getFilename();
        const options = (context.options[0] ?? {}) as Partial<RouteGuardConfig>;
        const findings = analyzeProgram(
          program as unknown as TSESTree.Program,
          filename,
          options
        );

        for (const finding of findings) {
          context.report({
            node: finding.sink.node as unknown as Rule.Node,
            message: finding.message,
          });
        }
      },
    };
  },
};
