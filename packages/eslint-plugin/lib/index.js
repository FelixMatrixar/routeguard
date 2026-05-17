/**
 * eslint-plugin-routeguard
 *
 * Usage in eslint.config.js:
 *
 *   import routeguard from 'eslint-plugin-routeguard';
 *   export default [{
 *     plugins: { routeguard },
 *     rules: {
 *       'routeguard/require-ownership-check': ['error', {
 *         ownershipFields: ['userId', 'ownerId'],
 *         frameworks: ['express', 'nestjs'],
 *       }]
 *     }
 *   }];
 *
 * TODO: implement rule using @typescript-eslint/utils RuleCreator
 */

module.exports = {
  rules: {
    'require-ownership-check': {
      // TODO: implement
    },
  },
  configs: {
    recommended: {
      rules: {
        'routeguard/require-ownership-check': 'error',
      },
    },
  },
};
