/**
 * Detection engine — handwritten IR fixtures.
 *
 * 24 cases: vulnerable / safe / edge for each of the 8 deterministic rules.
 * No adapters, no AST parsing — the engine is exercised through pure IR.
 */

import { analyze, defaultConfig } from '../../index';
import type {
  Route,
  Sink,
  FilterKey,
  TaintedSource,
  SinkKind,
  TaintSourceKind,
} from '../../index';

const node = { type: 'Identifier', name: 'fixture' } as unknown as TaintedSource['node'];

function taint(kind: TaintSourceKind, requestKey = 'id'): TaintedSource {
  return { kind, localName: requestKey, requestKey, node };
}

function filterKey(
  key: string,
  valueKind: FilterKey['valueKind'],
  taintSource?: TaintedSource
): FilterKey {
  return { key, valueKind, taintSource, node };
}

function route(sink: Sink): Route {
  return {
    framework: 'express',
    method: 'GET',
    path: '/fixture',
    handlerNode: node,
    taintedSources: [],
    authContext: null,
    sinks: [sink],
  };
}

function dbSink(kind: 'db-filter' | 'db-write', filterKeys: FilterKey[]): Sink {
  return { kind, node, operation: kind === 'db-write' ? 'write' : 'read', model: 'order', filterKeys };
}

function taintedArgSink(kind: SinkKind, source: TaintedSource): Sink {
  return { kind, node, taintedArg: { argIndex: 0, taintSource: source, node } };
}

function run(sink: Sink): number {
  return analyze([route(sink)], defaultConfig).length;
}

describe('no-bola (OWASP API1)', () => {
  it('flags a tainted filter with no ownership check', () => {
    expect(run(dbSink('db-filter', [filterKey('id', 'tainted', taint('route-param'))]))).toBe(1);
  });
  it('is safe when an ownership field is keyed to the auth context', () => {
    expect(
      run(
        dbSink('db-filter', [
          filterKey('id', 'tainted', taint('route-param')),
          filterKey('userId', 'auth-context'),
        ])
      )
    ).toBe(0);
  });
  it('edge: a fully literal filter is not a finding', () => {
    expect(run(dbSink('db-filter', [filterKey('status', 'literal')]))).toBe(0);
  });
});

describe('no-mass-assignment (OWASP API3)', () => {
  it('flags a write fed by a tainted body field', () => {
    expect(
      run(dbSink('db-write', [filterKey('(whole object)', 'tainted', taint('body-field', '*'))]))
    ).toBe(1);
  });
  it('is safe when written values are literals', () => {
    expect(run(dbSink('db-write', [filterKey('name', 'literal')]))).toBe(0);
  });
  it('edge: a write with no filter keys is not a finding', () => {
    expect(run(dbSink('db-write', []))).toBe(0);
  });
});

describe('no-ssrf (OWASP API7)', () => {
  it('flags a tainted outbound URL', () => {
    expect(run(taintedArgSink('outbound-url', taint('query-param', 'url')))).toBe(1);
  });
  it('is safe when no argument is tainted', () => {
    expect(run({ kind: 'outbound-url', node })).toBe(0);
  });
  it('edge: a body-sourced URL is still flagged', () => {
    expect(run(taintedArgSink('outbound-url', taint('body-field', 'url')))).toBe(1);
  });
});

describe('no-sql-injection (CWE-89)', () => {
  it('flags tainted input in raw SQL', () => {
    expect(run(taintedArgSink('raw-sql', taint('route-param')))).toBe(1);
  });
  it('is safe when no argument is tainted', () => {
    expect(run({ kind: 'raw-sql', node })).toBe(0);
  });
  it('edge: a query-sourced value is still flagged', () => {
    expect(run(taintedArgSink('raw-sql', taint('query-param')))).toBe(1);
  });
});

describe('no-command-injection (CWE-78)', () => {
  it('flags tainted input reaching a shell', () => {
    expect(run(taintedArgSink('shell-exec', taint('body-field', 'cmd')))).toBe(1);
  });
  it('is safe when no argument is tainted', () => {
    expect(run({ kind: 'shell-exec', node })).toBe(0);
  });
  it('edge: a route-param-sourced command is still flagged', () => {
    expect(run(taintedArgSink('shell-exec', taint('route-param', 'filename')))).toBe(1);
  });
});

describe('no-path-traversal (CWE-22)', () => {
  it('flags a tainted filesystem path', () => {
    expect(run(taintedArgSink('fs-path', taint('route-param', 'filename')))).toBe(1);
  });
  it('is safe when no argument is tainted', () => {
    expect(run({ kind: 'fs-path', node })).toBe(0);
  });
  it('edge: a query-sourced path is still flagged', () => {
    expect(run(taintedArgSink('fs-path', taint('query-param', 'file')))).toBe(1);
  });
});

describe('no-open-redirect (CWE-601)', () => {
  it('flags a tainted redirect target', () => {
    expect(run(taintedArgSink('redirect-url', taint('query-param', 'returnUrl')))).toBe(1);
  });
  it('is safe when no argument is tainted', () => {
    expect(run({ kind: 'redirect-url', node })).toBe(0);
  });
  it('edge: a route-param-sourced redirect is still flagged', () => {
    expect(run(taintedArgSink('redirect-url', taint('route-param', 'url')))).toBe(1);
  });
});

describe('no-hardcoded-secrets (CWE-798)', () => {
  it('flags a hardcoded secret value', () => {
    expect(run({ kind: 'hardcoded-secret', node, secretValue: 'sk-prod-abc123' })).toBe(1);
  });
  it('is safe when no secret value is present', () => {
    expect(run({ kind: 'hardcoded-secret', node })).toBe(0);
  });
  it('edge: an empty-string secret is not flagged', () => {
    expect(run({ kind: 'hardcoded-secret', node, secretValue: '' })).toBe(0);
  });
});

describe('engine plumbing', () => {
  it('skips routes listed in ignoreRoutes', () => {
    const r = route(dbSink('db-filter', [filterKey('id', 'tainted', taint('route-param'))]));
    r.path = '/health';
    expect(analyze([r], defaultConfig).length).toBe(0);
  });
});
