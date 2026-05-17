/**
 * Shared taint-tracking primitives.
 *
 * Used by every sink detector so that taint matching is implemented exactly
 * once. A request access (req.params.id, req.query.url, req.body) is tracked
 * by (kind, requestKey) — never by a loose property-name match, which would
 * flag unrelated expressions such as `config.url`.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { TaintedSource, TaintSourceKind } from '../ir/types';

const REQUEST_PROP_TO_KIND: Record<string, TaintSourceKind> = {
  params: 'route-param',
  query: 'query-param',
  body: 'body-field',
};

/**
 * Describes a request-access member expression if `node` is one.
 *
 * Keyed access — req.params.id → { kind: 'route-param', requestKey: 'id' }
 * Whole object — req.body      → { kind: 'body-field',  requestKey: '*' }
 *
 * Returns null for anything else (config.url, user.id, plain identifiers).
 */
export function classifyRequestMember(
  node: TSESTree.Node
): { kind: TaintSourceKind; requestKey: string } | null {
  if (node.type !== 'MemberExpression' || node.computed) return null;

  // Whole object: <ident>.params / .query / .body
  if (
    node.object.type === 'Identifier' &&
    node.property.type === 'Identifier' &&
    REQUEST_PROP_TO_KIND[node.property.name]
  ) {
    return { kind: REQUEST_PROP_TO_KIND[node.property.name], requestKey: '*' };
  }

  // Keyed: <ident>.params.<key> / .query.<key> / .body.<key>
  if (
    node.object.type === 'MemberExpression' &&
    !node.object.computed &&
    node.object.object.type === 'Identifier' &&
    node.object.property.type === 'Identifier' &&
    REQUEST_PROP_TO_KIND[node.object.property.name] &&
    node.property.type === 'Identifier'
  ) {
    return {
      kind: REQUEST_PROP_TO_KIND[node.object.property.name],
      requestKey: node.property.name,
    };
  }

  return null;
}

/**
 * Traces an expression back to a tainted source.
 *
 * - Identifier              → resolved against `taintedSources` by local name
 * - request MemberExpression → matched to a known source, else a synthetic one
 * - TemplateLiteral / `+`    → recurse into interpolations / operands
 *
 * Returns null when the expression carries no user-controlled input.
 */
export function traceTaint(
  node: TSESTree.Node,
  taintedSources: TaintedSource[]
): TaintedSource | null {
  if (node.type === 'Identifier') {
    return taintedSources.find((s) => s.localName === node.name) ?? null;
  }

  if (node.type === 'MemberExpression') {
    const req = classifyRequestMember(node);
    if (!req) return null;
    const known = taintedSources.find(
      (s) => s.kind === req.kind && s.requestKey === req.requestKey
    );
    if (known) return known;
    // Direct usage with no intermediate variable, e.g. axios.get(req.query.url).
    return { kind: req.kind, localName: '', requestKey: req.requestKey, node };
  }

  if (node.type === 'TemplateLiteral') {
    for (const expr of node.expressions) {
      const taint = traceTaint(expr, taintedSources);
      if (taint) return taint;
    }
    return null;
  }

  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return (
      traceTaint(node.left, taintedSources) ??
      traceTaint(node.right, taintedSources)
    );
  }

  return null;
}

/** Recursively walks each statement, invoking `visitor` on every node. */
export function walkStatements(
  statements: TSESTree.Node[],
  visitor: (node: TSESTree.Node) => void
): void {
  for (const stmt of statements) walkNode(stmt, visitor);
}

/** Recursively walks a node and its children, invoking `visitor` on each. */
export function walkNode(
  node: TSESTree.Node,
  visitor: (node: TSESTree.Node) => void
): void {
  visitor(node);

  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (!value || typeof value !== 'object') continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && 'type' in item) {
          walkNode(item as TSESTree.Node, visitor);
        }
      }
    } else if ('type' in value) {
      walkNode(value as TSESTree.Node, visitor);
    }
  }
}
