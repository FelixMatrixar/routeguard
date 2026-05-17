/**
 * Analysis orchestrator.
 *
 * Ties the framework adapters, the ORM adapter and the sink detectors to the
 * detection engine. This is the only module that imports adapters — the
 * engine itself stays adapter-agnostic.
 *
 * Pipeline: Program AST → Route[] (adapter) → sinks attached (detectors)
 *           → Finding[] (engine).
 */

import type { TSESTree } from '@typescript-eslint/utils';
import {
  analyze,
  mergeConfig,
  detectSSRFSinks,
  detectSQLInjectionSinks,
  detectCommandInjectionSinks,
  detectPathTraversalSinks,
  detectOpenRedirectSinks,
  detectHardcodedSecrets,
} from '@routeguard/core';
import type { Route, Finding, Framework, RouteGuardConfig } from '@routeguard/core';
import { extractRoutes as extractExpressRoutes } from '@routeguard/adapter-express';
import { extractRoutes as extractFastifyRoutes } from '@routeguard/adapter-fastify';
import { extractRoutes as extractNestJSRoutes } from '@routeguard/adapter-nestjs';
import { detectPrismaSinks } from '@routeguard/orm-prisma';

type HandlerFn = TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression;

/**
 * Analyses one file and returns every vulnerability finding.
 *
 * @param program - The file's parsed Program node
 * @param filename - Path of the file (used to skip test files for secrets)
 * @param partialConfig - User configuration overrides
 */
export function analyzeProgram(
  program: TSESTree.Program,
  filename: string,
  partialConfig: Partial<RouteGuardConfig> = {}
): Finding[] {
  const config = mergeConfig(partialConfig);
  const framework = detectFramework(program);

  const routes: Route[] = extractFrameworkRoutes(program, framework, config);

  for (const route of routes) {
    const handler = route.handlerNode;
    if (!isHandlerFn(handler)) continue;
    const authExpr = route.authContext?.expression ?? null;
    route.sinks = [
      ...detectPrismaSinks(handler, route.taintedSources, authExpr),
      ...detectSSRFSinks(handler, route.taintedSources),
      ...detectSQLInjectionSinks(handler, route.taintedSources),
      ...detectCommandInjectionSinks(handler, route.taintedSources),
      ...detectPathTraversalSinks(handler, route.taintedSources),
      ...detectOpenRedirectSinks(handler, route.taintedSources),
    ];
  }

  // Hardcoded secrets are a file-level concern, not tied to any route.
  const secretSinks = detectHardcodedSecrets(program, filename, config);
  if (secretSinks.length > 0) {
    routes.push({
      framework: framework ?? 'express',
      method: 'GET',
      path: '(file)',
      handlerNode: program,
      taintedSources: [],
      authContext: null,
      sinks: secretSinks,
    });
  }

  return analyze(routes, config);
}

/** Runs the adapter matching the file's framework. */
function extractFrameworkRoutes(
  program: TSESTree.Program,
  framework: Framework | null,
  config: RouteGuardConfig
): Route[] {
  if (framework === 'fastify') {
    return extractFastifyRoutes(program, config.authContext);
  }
  if (framework === 'nestjs') {
    return extractNestJSRoutes(program, config.authContext);
  }
  return extractExpressRoutes(program, config.authContext);
}

/**
 * Detects the framework from the file's imports. Express and Fastify route
 * registrations are syntactically identical, so running both adapters would
 * double-count — the import is the only reliable discriminator.
 */
function detectFramework(program: TSESTree.Program): Framework | null {
  let result: Framework | null = null;

  for (const stmt of program.body) {
    if (stmt.type === 'ImportDeclaration' && typeof stmt.source.value === 'string') {
      result = frameworkFromModule(stmt.source.value) ?? result;
    }
  }
  // require('fastify') style
  walkRequires(program, (moduleName) => {
    result = frameworkFromModule(moduleName) ?? result;
  });

  return result;
}

function frameworkFromModule(moduleName: string): Framework | null {
  if (moduleName === 'fastify') return 'fastify';
  if (moduleName.startsWith('@nestjs/')) return 'nestjs';
  if (moduleName === 'express') return 'express';
  return null;
}

/** Visits every `require('x')` call and reports the module name. */
function walkRequires(
  node: TSESTree.Node,
  visit: (moduleName: string) => void
): void {
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'require' &&
    node.arguments[0]?.type === 'Literal' &&
    typeof node.arguments[0].value === 'string'
  ) {
    visit(node.arguments[0].value);
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && 'type' in item) {
          walkRequires(item as TSESTree.Node, visit);
        }
      }
    } else if ('type' in value) {
      walkRequires(value as TSESTree.Node, visit);
    }
  }
}

function isHandlerFn(node: TSESTree.Node): node is HandlerFn {
  return (
    node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression'
  );
}
