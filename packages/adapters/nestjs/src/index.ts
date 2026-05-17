/**
 * NestJS Framework Adapter
 *
 * Converts NestJS AST patterns into Universal IR Route[].
 * Follows Express adapter structure but handles class-based controllers.
 *
 * Supported:
 *   @Controller('orders') class + @Get(':id') method
 *   @Param('id'), @Query('foo'), @Body() parameter decorators
 *   @UseGuards(JwtAuthGuard) for auth middleware
 *   @CurrentUser() (configurable) for auth context
 *
 * V1 HARD LIMIT:
 *   Cross-service calls (this.someService.method()) are NOT followed.
 *   These are marked as unanalyzable and skipped.
 *   In-controller analysis only.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { HttpMethod, TaintedSource, AuthContextRef, Route } from '@routeguard/core';

type AuthConfig = { property: string; idField: string };

/**
 * Walks a Program and produces one Route per NestJS controller method.
 *
 * V1 HARD LIMIT: cross-service calls (this.someService.method()) are NOT
 * followed. The handler node is still returned so in-method sinks can be
 * detected, but any call into an injected service is simply unanalyzable.
 *
 * @example
 * @Controller('orders')
 * export class OrdersController {
 *   @Get(':id')
 *   @UseGuards(JwtAuthGuard)
 *   async findOne(@Param('id') id: string) { ... }
 * }
 */
export function extractRoutes(
  program: TSESTree.Program,
  authConfig: AuthConfig
): Route[] {
  const routes: Route[] = [];
  const decoratorAuthConfig = { decoratorName: 'CurrentUser', idField: authConfig.idField };

  for (const stmt of program.body) {
    const classDecl = unwrapClassDeclaration(stmt);
    if (!classDecl) continue;

    const basePath = detectControllerDecorator(classDecl);
    if (basePath === null) continue;

    for (const member of classDecl.body.body) {
      if (member.type !== 'MethodDefinition') continue;

      const methodInfo = detectMethodDecorator(member);
      if (!methodInfo) continue;

      const fullPath = combineRoutePath(basePath, methodInfo.path);
      const taintedSources = extractTaintedSourcesFromParams(member);
      const authContext = extractAuthContextFromParams(member, decoratorAuthConfig);

      if (member.value.type !== 'FunctionExpression') continue;

      routes.push({
        framework: 'nestjs',
        method: methodInfo.method,
        path: fullPath,
        handlerNode: member.value,
        taintedSources,
        authContext,
        sinks: [],
      });
    }
  }

  return routes;
}

/** Unwraps export declarations to get at the ClassDeclaration within. */
function unwrapClassDeclaration(stmt: TSESTree.Statement): TSESTree.ClassDeclaration | null {
  if (stmt.type === 'ClassDeclaration') return stmt;
  if (
    stmt.type === 'ExportNamedDeclaration' &&
    stmt.declaration?.type === 'ClassDeclaration'
  ) {
    return stmt.declaration;
  }
  if (
    stmt.type === 'ExportDefaultDeclaration' &&
    stmt.declaration.type === 'ClassDeclaration'
  ) {
    return stmt.declaration;
  }
  return null;
}

/**
 * Detects @Controller decorator and extracts base path.
 *
 * Matches: @Controller('orders'), @Controller('/api/users')
 * Does NOT match: Other decorators, @Controller() without args
 *
 * @example
 * @Controller('orders')
 * export class OrdersController { ... }
 * // Returns: 'orders'
 */
export function detectControllerDecorator(
  node: TSESTree.ClassDeclaration
): string | null {
  if (!node.decorators || node.decorators.length === 0) return null;
  
  for (const decorator of node.decorators) {
    if (decorator.expression.type !== 'CallExpression') continue;
    if (decorator.expression.callee.type !== 'Identifier') continue;
    if (decorator.expression.callee.name !== 'Controller') continue;
    
    // Extract path from first argument
    if (decorator.expression.arguments.length === 0) return '';
    const firstArg = decorator.expression.arguments[0];
    if (firstArg.type !== 'Literal') continue;
    if (typeof firstArg.value !== 'string') continue;
    
    return firstArg.value;
  }
  
  return null;
}

/**
 * Detects HTTP method decorator and extracts method + path.
 *
 * Matches: @Get(':id'), @Post('create'), @Delete()
 * Does NOT match: @UseGuards, other decorators
 *
 * @example
 * @Get(':id')
 * async findOne(...) { ... }
 * // Returns: { method: 'GET', path: ':id' }
 */
export function detectMethodDecorator(
  node: TSESTree.MethodDefinition
): { method: HttpMethod; path: string } | null {
  if (!node.decorators || node.decorators.length === 0) return null;
  
  const validMethods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  
  for (const decorator of node.decorators) {
    if (decorator.expression.type !== 'CallExpression') continue;
    if (decorator.expression.callee.type !== 'Identifier') continue;
    
    const methodName = decorator.expression.callee.name.toUpperCase();
    if (!validMethods.includes(methodName as HttpMethod)) continue;
    
    // Extract path from first argument (optional)
    let path = '';
    if (decorator.expression.arguments.length > 0) {
      const firstArg = decorator.expression.arguments[0];
      if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
        path = firstArg.value;
      }
    }
    
    return {
      method: methodName as HttpMethod,
      path,
    };
  }
  
  return null;
}

/**
 * Combines controller base path with method path.
 *
 * Handles leading/trailing slashes correctly.
 *
 * @example
 * combineRoutePath('orders', ':id') → '/orders/:id'
 * combineRoutePath('/api/users', 'create') → '/api/users/create'
 * combineRoutePath('orders', '') → '/orders'
 */
export function combineRoutePath(basePath: string, methodPath: string): string {
  // Normalize: ensure base starts with / and doesn't end with /
  let normalized = basePath.startsWith('/') ? basePath : `/${basePath}`;
  if (normalized.endsWith('/') && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }
  
  // If no method path, return base
  if (!methodPath) return normalized;
  
  // Ensure method path doesn't start with /
  const cleanMethodPath = methodPath.startsWith('/') ? methodPath.slice(1) : methodPath;
  
  return `${normalized}/${cleanMethodPath}`;
}

/**
 * Extracts tainted sources from method parameter decorators.
 *
 * Finds patterns:
 * - @Param('id') id: string → route-param
 * - @Query('search') search: string → query-param
 * - @Body() body: CreateDto → body-field (uses 'body' as key)
 * - @Body('email') email: string → body-field with specific key
 *
 * @example
 * async findOne(
 *   @Param('id') id: string,
 *   @Query('include') include: string
 * ) { ... }
 * // Returns: [
 * //   { kind: 'route-param', localName: 'id', requestKey: 'id' },
 * //   { kind: 'query-param', localName: 'include', requestKey: 'include' }
 * // ]
 */
export function extractTaintedSourcesFromParams(
  methodNode: TSESTree.MethodDefinition
): TaintedSource[] {
  const sources: TaintedSource[] = [];
  
  if (methodNode.value.type !== 'FunctionExpression') return sources;
  
  for (const param of methodNode.value.params) {
    if (param.type !== 'Identifier') continue;
    if (!param.decorators || param.decorators.length === 0) continue;
    
    for (const decorator of param.decorators) {
      if (decorator.expression.type !== 'CallExpression') continue;
      if (decorator.expression.callee.type !== 'Identifier') continue;
      
      const decoratorName = decorator.expression.callee.name;
      let sourceKind: TaintedSource['kind'] | null = null;
      let requestKey = param.name; // Default to parameter name
      
      switch (decoratorName) {
        case 'Param':
          sourceKind = 'route-param';
          break;
        case 'Query':
          sourceKind = 'query-param';
          break;
        case 'Body':
          sourceKind = 'body-field';
          break;
        default:
          continue;
      }
      
      // Extract key from decorator argument if present
      if (decorator.expression.arguments.length > 0) {
        const firstArg = decorator.expression.arguments[0];
        if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
          requestKey = firstArg.value;
        }
      }
      
      sources.push({
        kind: sourceKind,
        localName: param.name,
        requestKey,
        node: param,
      });
    }
  }
  
  return sources;
}

/**
 * Detects @UseGuards decorator for auth middleware.
 *
 * Matches: @UseGuards(JwtAuthGuard), @UseGuards(AuthGuard('jwt'))
 * Returns true if any guard is present (indicates auth is required).
 *
 * @example
 * @Get(':id')
 * @UseGuards(JwtAuthGuard)
 * async findOne(...) { ... }
 * // Returns: true
 */
export function detectAuthGuard(node: TSESTree.MethodDefinition): boolean {
  if (!node.decorators || node.decorators.length === 0) return false;
  
  for (const decorator of node.decorators) {
    if (decorator.expression.type !== 'CallExpression') continue;
    if (decorator.expression.callee.type !== 'Identifier') continue;
    if (decorator.expression.callee.name === 'UseGuards') return true;
  }
  
  return false;
}

/**
 * Extracts authenticated user context from parameter decorators.
 *
 * Finds: @CurrentUser() user: UserEntity (or custom decorator name from config)
 * Returns reference like "user.id" based on parameter name + config.
 *
 * @example
 * // With config { decoratorName: 'CurrentUser', idField: 'id' }
 * async findOne(
 *   @CurrentUser() user: UserEntity
 * ) { ... }
 * // Returns: { expression: 'user.id', node: ... }
 */
export function extractAuthContextFromParams(
  methodNode: TSESTree.MethodDefinition,
  authConfig: { decoratorName: string; idField: string }
): AuthContextRef | null {
  if (methodNode.value.type !== 'FunctionExpression') return null;
  
  for (const param of methodNode.value.params) {
    if (param.type !== 'Identifier') continue;
    if (!param.decorators || param.decorators.length === 0) continue;
    
    for (const decorator of param.decorators) {
      if (decorator.expression.type !== 'CallExpression') continue;
      if (decorator.expression.callee.type !== 'Identifier') continue;
      
      if (decorator.expression.callee.name === authConfig.decoratorName) {
        return {
          expression: `${param.name}.${authConfig.idField}`,
          node: param,
        };
      }
    }
  }
  
  return null;
}

/**
 * Detects cross-service calls that cannot be analyzed.
 *
 * V1 HARD LIMIT: When a handler calls this.someService.method(),
 * we do NOT follow into the service class. This is marked as unanalyzable.
 *
 * Matches: this.ordersService.findOne(id), this.userService.update(...)
 * Does NOT match: this.localMethod(), direct function calls
 *
 * @example
 * async findOne(@Param('id') id: string) {
 *   return this.ordersService.findOne(id);  // ← unanalyzable
 * }
 * // Returns: true
 */
export function hasCrossServiceCall(methodNode: TSESTree.MethodDefinition): boolean {
  if (methodNode.value.type !== 'FunctionExpression') return false;
  if (methodNode.value.body.type !== 'BlockStatement') return false;
  
  // Walk the method body looking for this.*.method() pattern
  for (const stmt of methodNode.value.body.body) {
    if (hasThisServiceCallInNode(stmt)) return true;
  }
  
  return false;
}

/**
 * Recursively checks if a node contains this.service.method() pattern.
 *
 * Pattern: CallExpression where callee is MemberExpression with:
 *   - object.object.type === 'ThisExpression'
 *   - object.property is an Identifier (service name)
 *   - property is an Identifier (method name)
 */
function hasThisServiceCallInNode(node: TSESTree.Node): boolean {
  if (node.type === 'CallExpression') {
    if (node.callee.type === 'MemberExpression') {
      // Check for this.service.method pattern
      if (node.callee.object.type === 'MemberExpression') {
        if (node.callee.object.object.type === 'ThisExpression') {
          return true;
        }
      }
    }
    
    // Check arguments recursively
    for (const arg of node.arguments) {
      if (hasThisServiceCallInNode(arg)) return true;
    }
  }
  
  // Recursively check common node types
  if (node.type === 'ReturnStatement' && node.argument) {
    return hasThisServiceCallInNode(node.argument);
  }
  
  if (node.type === 'ExpressionStatement') {
    return hasThisServiceCallInNode(node.expression);
  }
  
  if (node.type === 'VariableDeclaration') {
    for (const decl of node.declarations) {
      if (decl.init && hasThisServiceCallInNode(decl.init)) return true;
    }
  }
  
  if (node.type === 'IfStatement') {
    if (hasThisServiceCallInNode(node.test)) return true;
    if (hasThisServiceCallInNode(node.consequent)) return true;
    if (node.alternate && hasThisServiceCallInNode(node.alternate)) return true;
  }
  
  if (node.type === 'BlockStatement') {
    for (const stmt of node.body) {
      if (hasThisServiceCallInNode(stmt)) return true;
    }
  }
  
  return false;
}

// Made with Bob
