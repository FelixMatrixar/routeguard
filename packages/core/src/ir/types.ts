/**
 * Universal Intermediate Representation (IR)
 *
 * The contract between framework adapters and the detection engine.
 * Adapters produce Route[]. ORM adapters produce Sink[].
 * The engine reads only these types — never imports from adapters or ORMs.
 *
 * ⚠️ STABILITY: Changes here require updating ALL adapters and ALL ORM packages.
 */

import type { TSESTree } from '@typescript-eslint/utils';

export type Framework = 'express' | 'fastify' | 'nestjs';
export type ORM = 'prisma' | 'drizzle' | 'typeorm' | 'raw-sql';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type DbOperation = 'read' | 'write' | 'delete';

export type TaintSourceKind =
  | 'route-param'   // req.params.id, @Param('id')
  | 'query-param'   // req.query.foo, @Query('foo')
  | 'body-field';   // req.body.userId, @Body()

export type TaintedSource = {
  kind: TaintSourceKind;
  /** Variable name the tainted value is bound to in handler scope */
  localName: string;
  /** Original key from the request, e.g. "id" from req.params.id */
  requestKey: string;
  node: TSESTree.Node;
};

export type AuthContextRef = {
  /** e.g. "req.user.id", "request.user.id", "user.id" */
  expression: string;
  node: TSESTree.Node;
};

export type FilterKeyValueKind =
  | 'tainted'       // traces back to a TaintedSource
  | 'auth-context'  // traces back to the auth user
  | 'literal'       // hardcoded value
  | 'unknown';      // could not resolve statically

export type FilterKey = {
  key: string;
  valueKind: FilterKeyValueKind;
  taintSource?: TaintedSource;
  node: TSESTree.Node;
};

export type Sink = {
  orm: ORM;
  operation: DbOperation;
  /** Model/table being queried, e.g. "order", "invoice" */
  model: string;
  filterKeys: FilterKey[];
  node: TSESTree.Node;
};

export type Route = {
  framework: Framework;
  method: HttpMethod;
  path: string;
  handlerNode: TSESTree.Node;
  taintedSources: TaintedSource[];
  authContext: AuthContextRef | null;
  sinks: Sink[];
};

export type FindingSeverity = 'error' | 'warning';

export type Finding = {
  route: Route;
  sink: Sink;
  taintedSource: TaintedSource;
  missingOwnershipFields: string[];
  severity: FindingSeverity;
  message: string;
  suggestion: string;
};
