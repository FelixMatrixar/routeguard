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

export type SinkKind =
  | 'db-filter'          // no-bola: DB read with tainted filter
  | 'db-write'           // no-mass-assignment: DB write with tainted data
  | 'outbound-url'       // no-ssrf: HTTP request with tainted URL
  | 'raw-sql'            // no-sql-injection: raw SQL with tainted input
  | 'shell-exec'         // no-command-injection: exec/spawn with tainted input
  | 'fs-path'            // no-path-traversal: fs operation with tainted path
  | 'redirect-url'       // no-open-redirect: res.redirect with tainted URL
  | 'hardcoded-secret';  // no-hardcoded-secrets: string literal in crypto/jwt

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
  kind: SinkKind;
  node: TSESTree.Node;
  
  // For db-filter and db-write only
  operation?: DbOperation;
  model?: string;
  filterKeys?: FilterKey[];
  
  // For outbound-url, raw-sql, shell-exec, fs-path, redirect-url
  taintedArg?: {
    argIndex: number;
    taintSource: TaintedSource;
    node: TSESTree.Node;
  };
  
  // For hardcoded-secret only
  secretValue?: string;
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
