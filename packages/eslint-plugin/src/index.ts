/**
 * eslint-plugin-routeguard
 *
 * Flat-config usage:
 *
 *   import routeguard from 'eslint-plugin-routeguard';
 *   export default [{
 *     plugins: { routeguard },
 *     rules: { 'routeguard/detect-vulnerabilities': 'error' },
 *   }];
 */

import { detectRule } from './rules/detect';

const plugin = {
  meta: { name: 'eslint-plugin-routeguard', version: '0.1.0' },
  rules: {
    'detect-vulnerabilities': detectRule,
  },
  configs: {} as Record<string, unknown>,
};

plugin.configs.recommended = {
  plugins: ['routeguard'],
  rules: { 'routeguard/detect-vulnerabilities': 'error' },
};

export = plugin;
