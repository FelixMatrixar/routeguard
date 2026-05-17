import type { FindingSeverity, Framework } from '../ir/types';

export type RouteGuardConfig = {
  ownershipFields: string[];
  authContext: { property: string; idField: string };
  frameworks: Framework[] | 'auto';
  ignoreRoutes: string[];
  severity: FindingSeverity;
};

export const defaultConfig: RouteGuardConfig = {
  ownershipFields: ['userId', 'ownerId', 'authorId', 'accountId'],
  authContext: { property: 'user', idField: 'id' },
  frameworks: 'auto',
  ignoreRoutes: ['/health', '/metrics', '/ping'],
  severity: 'error',
};

export function mergeConfig(partial: Partial<RouteGuardConfig>): RouteGuardConfig {
  return {
    ...defaultConfig,
    ...partial,
    authContext: { ...defaultConfig.authContext, ...partial.authContext },
  };
}
