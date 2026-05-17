/**
 * NestJS adapter unit tests.
 *
 * Parses TypeScript source with typescript-estree (already a transitive dep via
 * @typescript-eslint/utils) so we can feed real decorator ASTs to extractRoutes.
 */

import { parse } from '@typescript-eslint/typescript-estree';
import type { TSESTree } from '@typescript-eslint/utils';
import { extractRoutes } from '..';

const AUTH_CONFIG = { property: 'user', idField: 'id' };

function parseTS(code: string): TSESTree.Program {
  return parse(code, {
    jsx: false,
    loc: true,
    range: true,
    tokens: false,
  }) as unknown as TSESTree.Program;
}

describe('NestJS adapter — extractRoutes', () => {
  test('detects @Controller + @Get and returns a route', () => {
    const program = parseTS(`
      import { Controller, Get, Param } from '@nestjs/common';

      @Controller('orders')
      export class OrdersController {
        @Get(':id')
        async findOne(@Param('id') id: string) {
          return id;
        }
      }
    `);

    const routes = extractRoutes(program, AUTH_CONFIG);
    expect(routes).toHaveLength(1);
    expect(routes[0].framework).toBe('nestjs');
    expect(routes[0].method).toBe('GET');
    expect(routes[0].path).toBe('/orders/:id');
  });

  test('combines controller base path with method path correctly', () => {
    const program = parseTS(`
      import { Controller, Post } from '@nestjs/common';

      @Controller('/api/users')
      export class UsersController {
        @Post('create')
        create() {}
      }
    `);

    const routes = extractRoutes(program, AUTH_CONFIG);
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('/api/users/create');
  });

  test('extracts @Param tainted source as route-param', () => {
    const program = parseTS(`
      import { Controller, Get, Param } from '@nestjs/common';

      @Controller('items')
      export class ItemsController {
        @Get(':id')
        getOne(@Param('id') id: string) {}
      }
    `);

    const routes = extractRoutes(program, AUTH_CONFIG);
    expect(routes[0].taintedSources).toHaveLength(1);
    expect(routes[0].taintedSources[0].kind).toBe('route-param');
    expect(routes[0].taintedSources[0].requestKey).toBe('id');
    expect(routes[0].taintedSources[0].localName).toBe('id');
  });

  test('extracts @Query tainted source as query-param', () => {
    const program = parseTS(`
      import { Controller, Get, Query } from '@nestjs/common';

      @Controller('search')
      export class SearchController {
        @Get()
        find(@Query('q') q: string) {}
      }
    `);

    const routes = extractRoutes(program, AUTH_CONFIG);
    expect(routes[0].taintedSources[0].kind).toBe('query-param');
    expect(routes[0].taintedSources[0].requestKey).toBe('q');
  });

  test('extracts @Body tainted source as body-field', () => {
    const program = parseTS(`
      import { Controller, Post, Body } from '@nestjs/common';

      @Controller('users')
      export class UsersController {
        @Post()
        create(@Body() body: any) {}
      }
    `);

    const routes = extractRoutes(program, AUTH_CONFIG);
    expect(routes[0].taintedSources[0].kind).toBe('body-field');
  });

  test('extracts @CurrentUser auth context', () => {
    const program = parseTS(`
      import { Controller, Get, Param, UseGuards } from '@nestjs/common';

      @Controller('orders')
      export class OrdersController {
        @Get(':id')
        @UseGuards(JwtAuthGuard)
        findOne(@Param('id') id: string, @CurrentUser() user: any) {}
      }
    `);

    const routes = extractRoutes(program, AUTH_CONFIG);
    expect(routes[0].authContext).not.toBeNull();
    expect(routes[0].authContext?.expression).toBe('user.id');
  });

  test('handles multiple HTTP method decorators in one controller', () => {
    const program = parseTS(`
      import { Controller, Get, Post, Delete, Param } from '@nestjs/common';

      @Controller('products')
      export class ProductsController {
        @Get()
        findAll() {}

        @Post()
        create() {}

        @Delete(':id')
        remove(@Param('id') id: string) {}
      }
    `);

    const routes = extractRoutes(program, AUTH_CONFIG);
    expect(routes).toHaveLength(3);
    expect(routes.map(r => r.method).sort()).toEqual(['DELETE', 'GET', 'POST']);
    expect(routes.find(r => r.method === 'DELETE')?.path).toBe('/products/:id');
  });

  test('ignores methods without HTTP decorator', () => {
    const program = parseTS(`
      import { Controller, Get } from '@nestjs/common';

      @Controller('util')
      export class UtilController {
        @Get('info')
        getInfo() {}

        helperMethod() {}
      }
    `);

    const routes = extractRoutes(program, AUTH_CONFIG);
    expect(routes).toHaveLength(1);
  });

  test('ignores classes without @Controller decorator', () => {
    const program = parseTS(`
      export class NotAController {
        someMethod() {}
      }
    `);

    const routes = extractRoutes(program, AUTH_CONFIG);
    expect(routes).toHaveLength(0);
  });

  test('handles export default class', () => {
    const program = parseTS(`
      import { Controller, Get } from '@nestjs/common';

      @Controller('health')
      export default class HealthController {
        @Get()
        check() {}
      }
    `);

    const routes = extractRoutes(program, AUTH_CONFIG);
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('/health');
  });
});
