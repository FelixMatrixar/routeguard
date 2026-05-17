import type { FindingSeverity, Framework } from '../ir/types';

/**
 * RouteGuard configuration schema.
 *
 * Users can override these in their ESLint config or .routeguardrc.json.
 */
export type RouteGuardConfig = {
  /** Field names that indicate resource ownership (e.g., userId, ownerId) */
  ownershipFields: string[];
  
  /** How to extract authenticated user ID from request object */
  authContext: {
    /** Property name on request object (e.g., 'user' for req.user) */
    property: string;
    /** Field name within that property (e.g., 'id' for req.user.id) */
    idField: string;
  };
  
  /** Which frameworks to detect ('auto' = all, or explicit list) */
  frameworks: Framework[] | 'auto';
  
  /** Route paths to skip analysis (health checks, metrics, etc.) */
  ignoreRoutes: string[];
  
  /** Glob patterns for test files (hardcoded-secrets rule skips these) */
  testFilePatterns: string[];
  
  /** Severity level for findings */
  severity: FindingSeverity;
};

/**
 * Default configuration values.
 *
 * These are sensible defaults for most Node.js backends.
 */
export const defaultConfig: RouteGuardConfig = {
  ownershipFields: ['userId', 'ownerId', 'authorId', 'accountId'],
  authContext: { property: 'user', idField: 'id' },
  frameworks: 'auto',
  ignoreRoutes: ['/health', '/metrics', '/ping'],
  testFilePatterns: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.js', '**/*.spec.js'],
  severity: 'error',
};

/**
 * Merges user-provided partial config with defaults.
 *
 * Performs deep merge for nested objects (authContext).
 *
 * @param partial - User-provided config overrides
 * @returns Complete config with defaults filled in
 */
export function mergeConfig(partial: Partial<RouteGuardConfig>): RouteGuardConfig {
  return {
    ...defaultConfig,
    ...partial,
    // Deep merge authContext to allow partial overrides
    authContext: {
      ...defaultConfig.authContext,
      ...(partial.authContext || {}),
    },
  };
}
