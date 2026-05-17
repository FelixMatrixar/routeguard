/**
 * Detection Engine
 *
 * Reads Universal IR (Route[]) and produces Finding[].
 * Zero imports from adapters or ORM packages — IR only.
 *
 * Implements 8 deterministic vulnerability detection rules:
 * - no-bola (OWASP API1)
 * - no-mass-assignment (OWASP API3)
 * - no-ssrf (OWASP API7)
 * - no-sql-injection (CWE-89)
 * - no-command-injection (CWE-78)
 * - no-path-traversal (CWE-22)
 * - no-open-redirect (CWE-601)
 * - no-hardcoded-secrets (CWE-798)
 */

import type { Route, Sink, Finding, TaintedSource } from '../ir/types';
import type { RouteGuardConfig } from '../config/schema';

/**
 * Main analysis entry point.
 * Analyzes all routes and returns findings for all 8 rules.
 *
 * @param routes - IR routes produced by framework adapters
 * @param config - User configuration with ownership fields, auth context, etc.
 * @returns Array of findings, one per vulnerability detected
 */
export function analyze(routes: Route[], config: RouteGuardConfig): Finding[] {
  const findings: Finding[] = [];
  
  for (const route of routes) {
    // Skip routes explicitly ignored by user config
    if (config.ignoreRoutes.includes(route.path)) continue;
    
    for (const sink of route.sinks) {
      const finding = checkSink(route, sink, config);
      if (finding) findings.push(finding);
    }
  }
  
  return findings;
}

/**
 * Dispatches sink to appropriate rule checker based on sink.kind.
 *
 * @param route - The route containing this sink
 * @param sink - The sink to check
 * @param config - User configuration
 * @returns Finding if vulnerability detected, null if safe
 */
function checkSink(
  route: Route,
  sink: Sink,
  config: RouteGuardConfig
): Finding | null {
  switch (sink.kind) {
    case 'db-filter':
      return checkBOLA(route, sink, config);
    case 'db-write':
      return checkMassAssignment(route, sink, config);
    case 'outbound-url':
      return checkSSRF(route, sink, config);
    case 'raw-sql':
      return checkSQLInjection(route, sink, config);
    case 'shell-exec':
      return checkCommandInjection(route, sink, config);
    case 'fs-path':
      return checkPathTraversal(route, sink, config);
    case 'redirect-url':
      return checkOpenRedirect(route, sink, config);
    case 'hardcoded-secret':
      return checkHardcodedSecret(route, sink, config);
    default:
      return null;
  }
}

/**
 * Rule: no-bola (OWASP API1 - Broken Object Level Authorization)
 *
 * Detects when:
 * 1. A DB filter uses a tainted value (user-supplied ID)
 * 2. The filter does NOT include an ownership field tied to req.user.id
 *
 * Example vulnerable code:
 *   const order = await prisma.order.findUnique({ where: { id: req.params.id } })
 *
 * Safe code:
 *   const order = await prisma.order.findUnique({
 *     where: { id: req.params.id, userId: req.user.id }
 *   })
 */
function checkBOLA(
  route: Route,
  sink: Sink,
  config: RouteGuardConfig
): Finding | null {
  if (!sink.filterKeys) return null;
  
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
      `BOLA/IDOR: ${route.path} queries \`${sink.model}\` ` +
      `using user-supplied \`${primaryTaint.key}\` without an ownership check. ` +
      `Add one of [${config.ownershipFields.join(', ')}] to the query filter.`,
    suggestion:
      `Add \`${config.ownershipFields[0]}: ${route.authContext?.expression || 'req.user.id'}\` ` +
      `to the \`where\` clause to ensure the authenticated user owns the requested resource.`,
  };
}

/**
 * Rule: no-mass-assignment (OWASP API3 - Broken Object Property Level Authorization)
 *
 * Detects when:
 * 1. A DB write operation uses tainted data from req.body
 * 2. No explicit field allowlist is detected
 *
 * Example vulnerable code:
 *   await prisma.user.update({ where: { id }, data: req.body })
 *
 * Safe code:
 *   const { name, email } = req.body;
 *   await prisma.user.update({ where: { id }, data: { name, email } })
 */
function checkMassAssignment(
  route: Route,
  sink: Sink,
  config: RouteGuardConfig
): Finding | null {
  if (!sink.filterKeys) return null;
  
  // Check if any data field is tainted from req.body
  const taintedDataKeys = sink.filterKeys.filter(
    k => k.valueKind === 'tainted' && k.taintSource?.kind === 'body-field'
  );
  if (taintedDataKeys.length === 0) return null;
  
  // If we detect explicit field destructuring, it's safe
  // (This would be detected by the adapter as individual FilterKeys, not a whole-object taint)
  // For now, any tainted body field in a write = finding
  const primaryTaint = taintedDataKeys[0];
  
  return {
    route,
    sink,
    taintedSource: primaryTaint.taintSource!,
    missingOwnershipFields: [],
    severity: config.severity,
    message:
      `Mass Assignment: ${route.path} writes to \`${sink.model}\` ` +
      `using unsanitized \`req.body.${primaryTaint.taintSource!.requestKey}\`. ` +
      `Use explicit field allowlist instead of spreading entire request body.`,
    suggestion:
      `Destructure only allowed fields: \`const { field1, field2 } = req.body;\` ` +
      `then use \`{ field1, field2 }\` in the data clause.`,
  };
}

/**
 * Rule: no-ssrf (OWASP API7 - Server Side Request Forgery)
 *
 * Detects when:
 * A tainted value (user-supplied URL) reaches an outbound HTTP request
 *
 * Example vulnerable code:
 *   const data = await axios.get(req.query.url)
 *
 * Safe code:
 *   const allowedDomains = ['api.example.com'];
 *   if (!allowedDomains.some(d => url.startsWith(`https://${d}`))) throw error;
 *   const data = await axios.get(url);
 */
function checkSSRF(
  route: Route,
  sink: Sink,
  config: RouteGuardConfig
): Finding | null {
  if (!sink.taintedArg) return null;
  
  return {
    route,
    sink,
    taintedSource: sink.taintedArg.taintSource,
    missingOwnershipFields: [],
    severity: config.severity,
    message:
      `SSRF: ${route.path} makes outbound HTTP request ` +
      `using user-supplied URL from \`${sink.taintedArg.taintSource.requestKey}\`. ` +
      `Validate against an allowlist before making the request.`,
    suggestion:
      `Add allowlist check: \`if (!allowedDomains.includes(domain)) throw new Error('Invalid domain');\``,
  };
}

/**
 * Rule: no-sql-injection (CWE-89)
 *
 * Detects when:
 * A tainted value reaches a raw SQL query (string concatenation or template literal)
 *
 * Example vulnerable code:
 *   db.query(`SELECT * FROM users WHERE id = '${req.params.id}'`)
 *
 * Safe code:
 *   db.query('SELECT * FROM users WHERE id = ?', [req.params.id])
 */
function checkSQLInjection(
  route: Route,
  sink: Sink,
  config: RouteGuardConfig
): Finding | null {
  if (!sink.taintedArg) return null;
  
  return {
    route,
    sink,
    taintedSource: sink.taintedArg.taintSource,
    missingOwnershipFields: [],
    severity: config.severity,
    message:
      `SQL Injection: ${route.path} executes raw SQL ` +
      `with user-supplied value from \`${sink.taintedArg.taintSource.requestKey}\`. ` +
      `Use parameterized queries instead of string concatenation.`,
    suggestion:
      `Use parameterized query: \`db.query('SELECT * FROM table WHERE id = ?', [value])\``,
  };
}

/**
 * Rule: no-command-injection (CWE-78)
 *
 * Detects when:
 * A tainted value reaches exec/spawn with shell: true
 *
 * Example vulnerable code:
 *   exec(`convert ${req.params.filename} output.pdf`)
 *
 * Safe code:
 *   execFile('convert', [req.params.filename, 'output.pdf'])
 */
function checkCommandInjection(
  route: Route,
  sink: Sink,
  config: RouteGuardConfig
): Finding | null {
  if (!sink.taintedArg) return null;
  
  return {
    route,
    sink,
    taintedSource: sink.taintedArg.taintSource,
    missingOwnershipFields: [],
    severity: config.severity,
    message:
      `Command Injection: ${route.path} executes shell command ` +
      `with user-supplied value from \`${sink.taintedArg.taintSource.requestKey}\`. ` +
      `Use execFile with args array instead of exec with string.`,
    suggestion:
      `Use \`execFile(command, [arg1, arg2])\` instead of \`exec(\`command \${arg}\`)\``,
  };
}

/**
 * Rule: no-path-traversal (CWE-22)
 *
 * Detects when:
 * A tainted value reaches a filesystem operation without path.basename()
 *
 * Example vulnerable code:
 *   fs.readFile(`./uploads/${req.params.filename}`)
 *
 * Safe code:
 *   fs.readFile(path.join('./uploads', path.basename(req.params.filename)))
 */
function checkPathTraversal(
  route: Route,
  sink: Sink,
  config: RouteGuardConfig
): Finding | null {
  if (!sink.taintedArg) return null;
  
  return {
    route,
    sink,
    taintedSource: sink.taintedArg.taintSource,
    missingOwnershipFields: [],
    severity: config.severity,
    message:
      `Path Traversal: ${route.path} performs filesystem operation ` +
      `with user-supplied path from \`${sink.taintedArg.taintSource.requestKey}\`. ` +
      `Use path.basename() to prevent directory traversal.`,
    suggestion:
      `Wrap user input with \`path.basename()\` before using in filesystem operations.`,
  };
}

/**
 * Rule: no-open-redirect (CWE-601)
 *
 * Detects when:
 * A tainted value reaches res.redirect() without allowlist validation
 *
 * Example vulnerable code:
 *   res.redirect(req.query.returnUrl)
 *
 * Safe code:
 *   const allowedUrls = ['/dashboard', '/profile'];
 *   if (allowedUrls.includes(url)) res.redirect(url);
 */
function checkOpenRedirect(
  route: Route,
  sink: Sink,
  config: RouteGuardConfig
): Finding | null {
  if (!sink.taintedArg) return null;
  
  return {
    route,
    sink,
    taintedSource: sink.taintedArg.taintSource,
    missingOwnershipFields: [],
    severity: config.severity,
    message:
      `Open Redirect: ${route.path} redirects to user-supplied URL ` +
      `from \`${sink.taintedArg.taintSource.requestKey}\`. ` +
      `Validate against an allowlist before redirecting.`,
    suggestion:
      `Add allowlist check: \`if (!allowedUrls.includes(url)) throw new Error('Invalid redirect');\``,
  };
}

/**
 * Rule: no-hardcoded-secrets (CWE-798)
 *
 * Detects when:
 * A string literal (not process.env.X) is used in crypto/JWT operations
 *
 * Example vulnerable code:
 *   jwt.sign(payload, 'my-secret-key')
 *
 * Safe code:
 *   jwt.sign(payload, process.env.JWT_SECRET)
 */
function checkHardcodedSecret(
  route: Route,
  sink: Sink,
  config: RouteGuardConfig
): Finding | null {
  if (!sink.secretValue) return null;
  
  // Create a dummy tainted source for reporting (hardcoded secrets don't have taint flow)
  const dummyTaintSource: TaintedSource = {
    kind: 'body-field',
    localName: 'hardcoded',
    requestKey: 'hardcoded',
    node: sink.node,
  };
  
  return {
    route,
    sink,
    taintedSource: dummyTaintSource,
    missingOwnershipFields: [],
    severity: config.severity,
    message:
      `Hardcoded Secret: ${route.path} uses hardcoded string literal ` +
      `"${sink.secretValue.substring(0, 20)}..." in cryptographic operation. ` +
      `Use environment variables instead.`,
    suggestion:
      `Replace hardcoded secret with \`process.env.SECRET_NAME\` and store in .env file.`,
  };
}

// Made with Bob
