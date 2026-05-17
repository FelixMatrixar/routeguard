/**
 * Hardcoded Secrets Detector
 *
 * AST pattern matching (not taint analysis). Finds string literals used as
 * cryptographic material:
 *   jwt.sign(payload, 'secret') / jwt.verify(token, 'secret')
 *   crypto.createHmac(algo, 'secret') / createCipher / createDecipher
 *   const apiKey = 'sk-prod-123'  (name matches a secret-like pattern)
 *
 * Safe: process.env.X, config references, function calls. Test files
 * (per config.testFilePatterns) are skipped.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Sink } from '../ir/types';
import type { RouteGuardConfig } from '../config/schema';
import { walkNode } from '../taint';
import { minimatch } from 'minimatch';

const CRYPTO_CALLS: Record<string, string[]> = {
  jwt: ['sign', 'verify'],
  crypto: ['createHmac', 'createCipher', 'createDecipher'],
};

const SECRET_NAME_PATTERN = /secret|password|token|key|api[_-]?key/i;

/**
 * Detects hardcoded secrets across a whole file.
 *
 * @param ast - The file's Program node
 * @param filename - Path of the file being analysed
 * @param config - Active configuration (for testFilePatterns)
 * @returns Sinks with kind 'hardcoded-secret'
 */
export function detectHardcodedSecrets(
  ast: TSESTree.Program,
  filename: string,
  config: RouteGuardConfig
): Sink[] {
  if (isTestFile(filename, config.testFilePatterns)) return [];

  const sinks: Sink[] = [];
  walkNode(ast, (node) => {
    if (node.type === 'CallExpression') {
      const sink = detectCryptoCall(node);
      if (sink) sinks.push(sink);
    } else if (node.type === 'VariableDeclarator') {
      const sink = detectSecretVariable(node);
      if (sink) sinks.push(sink);
    }
  });
  return sinks;
}

/** jwt.sign(payload, 'secret'), crypto.createHmac(algo, 'secret') */
function detectCryptoCall(node: TSESTree.CallExpression): Sink | null {
  if (
    node.callee.type !== 'MemberExpression' ||
    node.callee.object.type !== 'Identifier' ||
    node.callee.property.type !== 'Identifier'
  ) {
    return null;
  }

  const methods = CRYPTO_CALLS[node.callee.object.name];
  if (!methods || !methods.includes(node.callee.property.name)) return null;

  const secretArg = node.arguments[1];
  if (!secretArg || !isHardcodedString(secretArg)) return null;

  return {
    kind: 'hardcoded-secret',
    node: secretArg,
    secretValue: secretArg.value as string,
  };
}

/** const apiKey = 'sk-prod-123' */
function detectSecretVariable(node: TSESTree.VariableDeclarator): Sink | null {
  if (node.id.type !== 'Identifier' || !SECRET_NAME_PATTERN.test(node.id.name)) {
    return null;
  }
  if (!node.init || !isHardcodedString(node.init)) return null;

  const value = node.init.value as string;
  if (value.length < 3) return null;

  return { kind: 'hardcoded-secret', node: node.init, secretValue: value };
}

function isHardcodedString(node: TSESTree.Node): node is TSESTree.StringLiteral {
  return node.type === 'Literal' && typeof node.value === 'string';
}

/** True when `filename` matches a configured test-file glob. */
function isTestFile(filename: string, patterns: string[]): boolean {
  const normalized = filename.replace(/\\/g, '/');
  return patterns.some((pattern) =>
    minimatch(normalized, pattern, { matchBase: true })
  );
}
