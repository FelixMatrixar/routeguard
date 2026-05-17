/**
 * Hardcoded Secrets Detector
 *
 * AST pattern matching (NOT taint analysis) to find string literals in:
 * - jwt.sign(payload, 'secret')
 * - jwt.verify(token, 'secret')
 * - crypto.createHmac(algo, 'secret')
 * - crypto.createCipher(algo, 'secret')
 * - crypto.createDecipher(algo, 'secret')
 * - const apiKey = 'sk-prod-123' (variable names matching secret patterns)
 *
 * Safe patterns (NOT flagged):
 * - jwt.sign(payload, process.env.JWT_SECRET)
 * - jwt.sign(payload, config.secret)
 * - jwt.sign(payload, getSecret())
 * - const apiKey = process.env.API_KEY
 *
 * Skips files matching testFilePatterns config.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Sink } from '../ir/types';
import type { RouteGuardConfig } from '../config/schema';
import { minimatch } from 'minimatch';

/**
 * Detects hardcoded secrets in a file's AST.
 *
 * @param ast - The file's AST root node
 * @param filename - Full path to the file being analyzed
 * @param config - User configuration (for testFilePatterns)
 * @returns Array of Sink nodes with kind 'hardcoded-secret'
 */
export function detectHardcodedSecrets(
  ast: TSESTree.Program,
  filename: string,
  config: RouteGuardConfig
): Sink[] {
  // Skip test files
  if (isTestFile(filename, config.testFilePatterns)) {
    return [];
  }

  const sinks: Sink[] = [];

  // Walk the AST looking for crypto/JWT calls and suspicious variable declarations
  walkAST(ast, (node) => {
    // Pattern 1: jwt.sign/verify, crypto.createHmac/createCipher/createDecipher
    if (node.type === 'CallExpression') {
      const sink = detectCryptoCallWithHardcodedSecret(node);
      if (sink) sinks.push(sink);
    }

    // Pattern 2: const apiKey = 'hardcoded-value'
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        const sink = detectVariableWithHardcodedSecret(decl);
        if (sink) sinks.push(sink);
      }
    }
  });

  return sinks;
}

/**
 * Detects hardcoded secrets in crypto/JWT function calls.
 *
 * Matches:
 * - jwt.sign(payload, 'secret')
 * - jwt.verify(token, 'secret')
 * - crypto.createHmac('sha256', 'secret')
 * - crypto.createCipher('aes-256-cbc', 'secret')
 * - crypto.createDecipher('aes-256-cbc', 'secret')
 *
 * Does NOT match:
 * - jwt.sign(payload, process.env.JWT_SECRET)
 * - jwt.sign(payload, secretVar)
 * - jwt.sign(payload, getSecret())
 */
function detectCryptoCallWithHardcodedSecret(
  node: TSESTree.CallExpression
): Sink | null {
  // Must be: someObj.method(...)
  if (node.callee.type !== 'MemberExpression') return null;
  if (node.callee.object.type !== 'Identifier') return null;
  if (node.callee.property.type !== 'Identifier') return null;

  const objName = node.callee.object.name;
  const methodName = node.callee.property.name;

  // jwt.sign(payload, secret) or jwt.verify(token, secret)
  if (objName === 'jwt' && (methodName === 'sign' || methodName === 'verify')) {
    if (node.arguments.length < 2) return null;
    const secretArg = node.arguments[1];

    if (isHardcodedStringLiteral(secretArg)) {
      return {
        kind: 'hardcoded-secret',
        node: secretArg,
        secretValue: (secretArg as TSESTree.Literal).value as string,
      };
    }
  }

  // crypto.createHmac(algorithm, secret)
  // crypto.createCipher(algorithm, secret)
  // crypto.createDecipher(algorithm, secret)
  if (
    objName === 'crypto' &&
    (methodName === 'createHmac' ||
      methodName === 'createCipher' ||
      methodName === 'createDecipher')
  ) {
    if (node.arguments.length < 2) return null;
    const secretArg = node.arguments[1];

    if (isHardcodedStringLiteral(secretArg)) {
      return {
        kind: 'hardcoded-secret',
        node: secretArg,
        secretValue: (secretArg as TSESTree.Literal).value as string,
      };
    }
  }

  return null;
}

/**
 * Detects hardcoded secrets in variable declarations.
 *
 * Matches:
 * - const apiKey = 'sk-prod-123'
 * - const jwtSecret = 'my-secret'
 * - const password = 'admin123'
 *
 * Does NOT match:
 * - const apiKey = process.env.API_KEY
 * - const apiKey = getApiKey()
 * - const apiKey = config.key
 * - const normalVar = 'some-value' (name doesn't match pattern)
 */
function detectVariableWithHardcodedSecret(
  node: TSESTree.VariableDeclarator
): Sink | null {
  // Must have an identifier name
  if (node.id.type !== 'Identifier') return null;

  const varName = node.id.name;

  // Variable name must suggest it's a secret
  const secretPattern = /secret|password|token|key|api[_-]?key/i;
  if (!secretPattern.test(varName)) return null;

  // Init value must exist
  if (!node.init) return null;

  // Init value must be a non-empty string literal
  if (isHardcodedStringLiteral(node.init)) {
    const secretValue = (node.init as TSESTree.Literal).value as string;
    
    // Skip empty strings and very short values (likely not real secrets)
    if (secretValue.length === 0 || secretValue.length < 3) return null;

    return {
      kind: 'hardcoded-secret',
      node: node.init,
      secretValue,
    };
  }

  return null;
}

/**
 * Checks if a node is a hardcoded string literal.
 *
 * Returns true for: 'hardcoded-value'
 * Returns false for: process.env.X, variable, function call, etc.
 */
function isHardcodedStringLiteral(node: TSESTree.Node): boolean {
  return node.type === 'Literal' && typeof node.value === 'string';
}

/**
 * Checks if a filename matches any test file pattern.
 *
 * @param filename - Full path to the file
 * @param patterns - Glob patterns from config.testFilePatterns
 * @returns true if file should be skipped (is a test file)
 */
function isTestFile(filename: string, patterns: string[]): boolean {
  // Normalize path separators for cross-platform compatibility
  const normalizedPath = filename.replace(/\\/g, '/');

  for (const pattern of patterns) {
    if (minimatch(normalizedPath, pattern, { matchBase: true })) {
      return true;
    }
  }

  return false;
}

/**
 * Recursively walks an AST and calls visitor for each node.
 *
 * @param node - Current AST node
 * @param visitor - Function to call for each node
 */
function walkAST(node: TSESTree.Node, visitor: (node: TSESTree.Node) => void): void {
  visitor(node);

  // Recursively visit all child nodes
  for (const key in node) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue;

    const value = (node as any)[key];

    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && item.type) {
            walkAST(item, visitor);
          }
        }
      } else if (value.type) {
        walkAST(value, visitor);
      }
    }
  }
}

// Made with Bob