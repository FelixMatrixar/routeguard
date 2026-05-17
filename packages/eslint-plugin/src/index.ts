/**
 * @felix-neuro/eslint-plugin-routeguard
 *
 * Flat-config usage (eslint.config.mjs):
 *
 *   import routeguard from '@felix-neuro/eslint-plugin-routeguard';
 *   export default [routeguard.configs.recommended];
 *
 * Legacy usage (.eslintrc):
 *
 *   { "plugins": ["routeguard"], "extends": ["plugin:routeguard/recommended"] }
 */

import { makeRule } from './rules/make-rule';
import { detectRule } from './rules/detect';

const rules = {
  // The 8 individual rules — enable/disable per-rule in your config.
  'no-bola':             makeRule('db-filter'),
  'no-mass-assignment':  makeRule('db-write'),
  'no-ssrf':             makeRule('outbound-url'),
  'no-sql-injection':    makeRule('raw-sql'),
  'no-command-injection': makeRule('shell-exec'),
  'no-path-traversal':   makeRule('fs-path'),
  'no-open-redirect':    makeRule('redirect-url'),
  'no-hardcoded-secrets': makeRule('hardcoded-secret'),
  // Combined rule kept for backward compatibility.
  'detect-vulnerabilities': detectRule,
};

const plugin = {
  meta: { name: '@felix-neuro/eslint-plugin-routeguard', version: '0.1.1' },
  rules,
  configs: {} as Record<string, unknown>,
};

// Flat-config recommended (eslint.config.mjs)
plugin.configs['recommended'] = {
  plugins: { routeguard: plugin },
  rules: {
    'routeguard/no-bola':              'error',
    'routeguard/no-mass-assignment':   'error',
    'routeguard/no-ssrf':              'error',
    'routeguard/no-sql-injection':     'error',
    'routeguard/no-command-injection': 'error',
    'routeguard/no-path-traversal':    'error',
    'routeguard/no-open-redirect':     'error',
    'routeguard/no-hardcoded-secrets': 'error',
  },
};

// Legacy recommended (.eslintrc)
plugin.configs['recommended-legacy'] = {
  plugins: ['routeguard'],
  rules: {
    'routeguard/no-bola':              'error',
    'routeguard/no-mass-assignment':   'error',
    'routeguard/no-ssrf':              'error',
    'routeguard/no-sql-injection':     'error',
    'routeguard/no-command-injection': 'error',
    'routeguard/no-path-traversal':    'error',
    'routeguard/no-open-redirect':     'error',
    'routeguard/no-hardcoded-secrets': 'error',
  },
};

export = plugin;
