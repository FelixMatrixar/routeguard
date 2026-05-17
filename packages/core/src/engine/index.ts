/**
 * Detection Engine
 *
 * Reads Universal IR (Route[]) and produces Finding[].
 * Zero imports from adapters or ORM packages — IR only.
 *
 * TODO: implement checkSinkForBOLA fully
 */

import type { Route, Finding } from '../ir/types';
import type { RouteGuardConfig } from '../config/schema';

export function analyze(routes: Route[], config: RouteGuardConfig): Finding[] {
  const findings: Finding[] = [];
  for (const route of routes) {
    if (config.ignoreRoutes.includes(route.path)) continue;
    for (const sink of route.sinks) {
      const finding = checkSinkForBOLA(route, sink, config);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

function checkSinkForBOLA(
  route: Route,
  sink: Route['sinks'][0],
  config: RouteGuardConfig
): Finding | null {
  // Condition 1: at least one filter key must be tainted
  const taintedKeys = sink.filterKeys.filter(k => k.valueKind === 'tainted');
  if (taintedKeys.length === 0) return null;

  // Condition 2: if an ownership field keyed to auth-context is present, it's safe
  const hasOwnershipCheck = sink.filterKeys.some(
    k => config.ownershipFields.includes(k.key) && k.valueKind === 'auth-context'
  );
  if (hasOwnershipCheck) return null;

  // Condition 3: tainted + no ownership = BOLA
  const primaryTaint = taintedKeys[0];

  return {
    route,
    sink,
    taintedSource: primaryTaint.taintSource!,
    missingOwnershipFields: config.ownershipFields,
    severity: config.severity,
    message:
      `BOLA/IDOR: ${route.method} ${route.path} queries \`${sink.model}\` ` +
      `using user-supplied \`${primaryTaint.key}\` without an ownership check. ` +
      `Add one of [${config.ownershipFields.join(', ')}] to the query filter.`,
    suggestion:
      `Add \`${config.ownershipFields[0]}: req.user.id\` to the \`where\` clause ` +
      `to ensure the authenticated user owns the requested resource.`,
  };
}
