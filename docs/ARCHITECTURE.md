# RouteGuard Architecture

## Two-layer architecture

RouteGuard uses a **deterministic engine + AI agent** architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    Layer 1: Deterministic Engine             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Framework  │───▶│  Universal   │───▶│  Detection   │  │
│  │   Adapters   │    │      IR      │    │    Engine    │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                                         │          │
│         │                                         ▼          │
│    ┌────────┐                              ┌──────────┐     │
│    │  ORM   │                              │ Finding[]│     │
│    │Adapters│                              └──────────┘     │
│    └────────┘                                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Layer 2: AI Agent (Optional)                    │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  Knowledge   │───▶│    ReAct     │───▶│   Granite    │  │
│  │   Skills     │    │     Loop     │    │   3.3 2B     │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│                                                 │            │
│                                                 ▼            │
│                                          ┌──────────┐        │
│                                          │ Finding[]│        │
│                                          └──────────┘        │
└─────────────────────────────────────────────────────────────┘
```

**Layer 1** (Deterministic):
- Zero false positives by design
- Fast: <5s for 10K LOC
- CI-safe: deterministic, reproducible
- 8 rules covering OWASP API Top 10

**Layer 2** (AI Agent):
- On-demand deep analysis
- 6 additional rules
- Slower: 2-5s per route
- May produce false positives

## The taint analysis model

A vulnerability exists when **ALL THREE** conditions are met:

```
┌─────────────────────────────────────────────────────────────┐
│                                                               │
│  SOURCE                 SINK                    GUARD        │
│  (user input)           (sensitive op)          (ownership)  │
│                                                               │
│  req.params.id    ───▶  prisma.order.findUnique             │
│                         { where: { id } }                    │
│                                                               │
│                         ❌ Missing: userId: req.user.id      │
│                                                               │
│  = BOLA VULNERABILITY                                        │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### ASCII diagram

```
Route Handler
│
├─ SOURCE: const { id } = req.params
│           ↓ (taint propagates)
│
├─ SINK: prisma.order.findUnique({ where: { id } })
│         ↓
│         Check: Does filter include ownership field?
│         ↓
│         ❌ NO → FINDING
│         ✅ YES → SAFE
│
└─ GUARD: { where: { id, userId: req.user.id } }
           ↑
           Ownership check present
```

### Three-condition model

1. **Tainted Source** — User-controlled input enters the handler
   - Route params: `req.params.id`
   - Query params: `req.query.search`
   - Body fields: `req.body.email`

2. **Sensitive Sink** — Tainted value reaches a dangerous operation
   - DB filter: `prisma.order.findUnique({ where: { id } })`
   - DB write: `prisma.user.update({ data: req.body })`
   - Outbound HTTP: `axios.get(req.query.url)`
   - Raw SQL: `` db.query(`SELECT * FROM users WHERE id = '${id}'`) ``
   - Shell exec: `` exec(`convert ${filename} output.pdf`) ``
   - File system: `fs.readFile(req.params.path)`
   - Redirect: `res.redirect(req.query.returnUrl)`

3. **Missing Guard** — No ownership check or validation present
   - For BOLA: Missing `userId: req.user.id` in filter
   - For SSRF: Missing URL allowlist validation
   - For SQL injection: Missing parameterization
   - For path traversal: Missing `path.basename()`

## The Universal IR

### Why it exists

Without IR, adding a new framework would require:
- Updating every detection rule to understand the new AST
- Modifying the engine to handle framework-specific patterns
- Testing all rules against all frameworks (N×M complexity)

With IR:
- Framework adapter produces `Route[]` in universal format
- Engine reads only IR types (zero framework knowledge)
- Adding a framework = writing one adapter (~300 lines)
- N+M complexity instead of N×M

### Stability contract

**⚠️ CRITICAL**: Changes to IR types require updating ALL adapters and ALL ORM packages.

The IR is the **contract** between:
- Framework adapters (producers)
- ORM adapters (producers)
- Detection engine (consumer)

Breaking changes must be versioned and coordinated across all packages.

### All types explained

#### `Framework`
```typescript
type Framework = 'express' | 'fastify' | 'nestjs';
```
Identifies which framework produced this route. Used for framework-specific error messages.

#### `ORM`
```typescript
type ORM = 'prisma' | 'drizzle' | 'typeorm' | 'raw-sql';
```
Identifies which ORM produced a sink. Used for ORM-specific fix suggestions.

#### `HttpMethod`
```typescript
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
```
HTTP method of the route. Used to determine expected behavior (e.g., GET should not write).

#### `DbOperation`
```typescript
type DbOperation = 'read' | 'write' | 'delete';
```
Type of database operation. Used to determine which rules apply.

#### `SinkKind`
```typescript
type SinkKind =
  | 'db-filter'          // no-bola: DB read with tainted filter
  | 'db-write'           // no-mass-assignment: DB write with tainted data
  | 'outbound-url'       // no-ssrf: HTTP request with tainted URL
  | 'raw-sql'            // no-sql-injection: raw SQL with tainted input
  | 'shell-exec'         // no-command-injection: exec/spawn with tainted input
  | 'fs-path'            // no-path-traversal: fs operation with tainted path
  | 'redirect-url'       // no-open-redirect: res.redirect with tainted URL
  | 'hardcoded-secret';  // no-hardcoded-secrets: string literal in crypto/jwt
```
Categorizes the type of sink. Each kind maps to one detection rule.

#### `TaintSourceKind`
```typescript
type TaintSourceKind =
  | 'route-param'   // req.params.id, @Param('id')
  | 'query-param'   // req.query.foo, @Query('foo')
  | 'body-field';   // req.body.userId, @Body()
```
Categorizes where user input came from. Used in error messages and fix suggestions.

#### `TaintedSource`
```typescript
type TaintedSource = {
  kind: TaintSourceKind;
  localName: string;        // Variable name in handler scope
  requestKey: string;       // Original key from request
  node: TSESTree.Node;      // AST node for error location
};
```
Represents a single user-controlled input that entered the handler.

**Example**:
```typescript
const { id } = req.params;
// → TaintedSource {
//     kind: 'route-param',
//     localName: 'id',
//     requestKey: 'id',
//     node: Identifier('id')
//   }
```

#### `AuthContextRef`
```typescript
type AuthContextRef = {
  expression: string;       // e.g., "req.user.id"
  node: TSESTree.Node;
};
```
Represents the authenticated user reference found in the handler. Used to verify ownership checks.

#### `FilterKeyValueKind`
```typescript
type FilterKeyValueKind =
  | 'tainted'       // Traces back to a TaintedSource
  | 'auth-context'  // Traces back to req.user.id
  | 'literal'       // Hardcoded value
  | 'unknown';      // Could not resolve statically
```
Classifies the origin of a filter value. Core of the BOLA detection logic.

#### `FilterKey`
```typescript
type FilterKey = {
  key: string;                  // Field name (e.g., 'userId')
  valueKind: FilterKeyValueKind;
  taintSource?: TaintedSource;  // Present if valueKind === 'tainted'
  node: TSESTree.Node;
};
```
Represents a single key-value pair in a DB filter or write operation.

**Example**:
```typescript
{ where: { id: req.params.id, userId: req.user.id } }
// → FilterKey[] = [
//     { key: 'id', valueKind: 'tainted', taintSource: ... },
//     { key: 'userId', valueKind: 'auth-context' }
//   ]
```

#### `Sink`
```typescript
type Sink = {
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
```
Represents a dangerous operation that may be vulnerable. Produced by ORM adapters.

#### `Route`
```typescript
type Route = {
  framework: Framework;
  method: HttpMethod;
  path: string;
  handlerNode: TSESTree.Node;
  taintedSources: TaintedSource[];
  authContext: AuthContextRef | null;
  sinks: Sink[];
};
```
Represents a complete route handler with all its taint sources and sinks. Produced by framework adapters.

#### `Finding`
```typescript
type Finding = {
  route: Route;
  sink: Sink;
  taintedSource: TaintedSource;
  missingOwnershipFields: string[];
  severity: FindingSeverity;
  message: string;
  suggestion: string;
};
```
Represents a detected vulnerability. Produced by the detection engine.

## Package boundaries

| Package | Produces | Must NOT |
|---------|----------|----------|
| `packages/core` | IR types, `Finding[]` | Import from adapters/ORMs |
| `packages/adapters/*` | `Route` IR | Contain detection logic, know about ORMs |
| `packages/orms/*` | `Sink` IR | Know about frameworks, contain detection logic |
| `packages/eslint-plugin` | ESLint diagnostics | Bypass IR, implement detection logic |

### Why these boundaries matter

**Violation example** (BAD):
```typescript
// packages/adapters/express/src/index.ts
import { detectPrismaSink } from '@routeguard/orm-prisma';  // ❌ WRONG

// This creates a dependency cycle and breaks the IR abstraction
```

**Correct approach** (GOOD):
```typescript
// packages/adapters/express/src/index.ts
export function extractRoutes(program: TSESTree.Program): Route[] {
  // Return Route[] with empty sinks array
  return routes.map(r => ({ ...r, sinks: [] }));
}

// packages/eslint-plugin/lib/index.js
const routes = extractRoutes(program);
for (const route of routes) {
  // Orchestrator fills sinks by calling ORM adapters
  route.sinks = detectPrismaSinks(route.handlerNode, ...);
}
```

## The AI agent layer

### Knowledge skills

The AI agent has 6 specialized detection skills:

1. **auth-bypass** — Detects authentication bypass patterns
   - Missing auth middleware
   - Conditional auth with logic flaws
   - Token validation issues

2. **rate-limit** — Detects missing rate limiting
   - Login endpoints without rate limiting
   - Expensive operations without throttling
   - API endpoints without quotas

3. **input-validation** — Detects insufficient input validation
   - Missing type checks
   - Insufficient length validation
   - Missing format validation (email, URL, etc.)

4. **sensitive-data** — Detects sensitive data exposure
   - Passwords in responses
   - PII in logs
   - Secrets in error messages

5. **crypto-misuse** — Detects cryptographic misuse
   - Weak algorithms (MD5, SHA1)
   - Insufficient key lengths
   - Missing salt in password hashing

6. **logic-flaws** — Detects business logic vulnerabilities
   - Race conditions
   - Integer overflow
   - Incorrect state transitions

### ReAct loop

The AI agent uses a **Reasoning + Acting** loop:

```
1. OBSERVE: Read route handler AST
2. THINK: Apply detection skill
3. ACT: Generate finding or request more context
4. REPEAT: Until confident or max iterations (5)
```

**Example**:
```
Iteration 1:
  OBSERVE: Route has @UseGuards(JwtAuthGuard)
  THINK: Auth guard present, but is it correctly configured?
  ACT: Read JwtAuthGuard implementation

Iteration 2:
  OBSERVE: JwtAuthGuard validates token but doesn't check expiry
  THINK: This is an auth bypass vulnerability
  ACT: Generate finding with fix suggestion
```

### Granite 3.3 2B

**Why Granite 3.3 2B?**
- Small enough to run locally (1.5GB GGUF)
- Fast inference (~2-5s per route on M1 Mac)
- Trained on code (IBM's Granite family)
- Permissive license (Apache 2.0)

**Limitations**:
- 2B parameters = limited reasoning capacity
- May miss complex logic flaws
- May produce false positives
- Not suitable for production-critical decisions

**Future**: V2 will support larger models (7B+) and ensemble voting.

## Adding a framework

5-step process (~300 lines of code):

### 1. Create adapter package

```bash
mkdir -p packages/adapters/hono/src
touch packages/adapters/hono/src/index.ts
touch packages/adapters/hono/package.json
touch packages/adapters/hono/tsconfig.json
```

### 2. Implement core functions

```typescript
// packages/adapters/hono/src/index.ts
import type { Route } from '@routeguard/core';

export function extractRoutes(
  program: TSESTree.Program,
  authConfig: { property: string; idField: string }
): Route[] {
  // 1. Find route registrations: app.get('/path', handler)
  // 2. Extract tainted sources from handler
  // 3. Extract auth context from handler
  // 4. Return Route[] with empty sinks array
}
```

### 3. Add example project

```bash
mkdir -p examples/vulnerable-hono
# Create a small Hono app with intentional vulnerabilities
```

### 4. Write tests

```typescript
// packages/adapters/hono/tests/index.test.ts
import { extractRoutes } from '../src';

test('detects Hono route registration', () => {
  const code = `
    app.get('/orders/:id', async (c) => {
      const id = c.req.param('id');
      return c.json({ id });
    });
  `;
  const routes = extractRoutes(parse(code), defaultAuthConfig);
  expect(routes).toHaveLength(1);
  expect(routes[0].path).toBe('/orders/:id');
});
```

### 5. Register in ESLint plugin

```javascript
// packages/eslint-plugin/lib/index.js
import { extractRoutes as extractHonoRoutes } from '@routeguard/adapter-hono';

// Add to framework detection logic
```

**Zero engine changes required!**

## Adding an ORM

4-step process (~400 lines of code):

### 1. Create ORM package

```bash
mkdir -p packages/orms/mongoose/src
touch packages/orms/mongoose/src/index.ts
touch packages/orms/mongoose/package.json
touch packages/orms/mongoose/tsconfig.json
```

### 2. Implement sink detection

```typescript
// packages/orms/mongoose/src/index.ts
import type { Sink } from '@routeguard/core';

export function detectMongooseSinks(
  handlerNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  taintedSources: TaintedSource[],
  authContextExpr: string | null
): Sink[] {
  // 1. Walk handler AST
  // 2. Find Mongoose calls: Model.findOne(), Model.updateOne(), etc.
  // 3. Extract filter keys from query object
  // 4. Classify each key as tainted/auth-context/literal/unknown
  // 5. Return Sink[] with kind='db-filter' or 'db-write'
}
```

### 3. Add tests

```typescript
// packages/orms/mongoose/tests/index.test.ts
test('detects Mongoose findOne with tainted filter', () => {
  const code = `
    async (req, res) => {
      const { id } = req.params;
      const order = await Order.findOne({ _id: id });
    }
  `;
  const sinks = detectMongooseSinks(parse(code), taintedSources, null);
  expect(sinks).toHaveLength(1);
  expect(sinks[0].kind).toBe('db-filter');
});
```

### 4. Register in orchestrator

```javascript
// packages/eslint-plugin/lib/index.js
import { detectMongooseSinks } from '@routeguard/orm-mongoose';

// Add to ORM detection logic
```

## Adding a rule

3-step process (~100 lines of code):

### 1. Add sink kind to IR

```typescript
// packages/core/src/ir/types.ts
export type SinkKind =
  | 'db-filter'
  | 'db-write'
  | 'your-new-sink-kind';  // ← Add here
```

### 2. Implement detection logic

```typescript
// packages/core/src/engine/index.ts
function checkSink(route: Route, sink: Sink, config: RouteGuardConfig): Finding | null {
  switch (sink.kind) {
    case 'your-new-sink-kind':
      return checkYourNewRule(route, sink, config);
    // ...
  }
}

function checkYourNewRule(
  route: Route,
  sink: Sink,
  config: RouteGuardConfig
): Finding | null {
  // Implement your detection logic here
  // Return Finding if vulnerable, null if safe
}
```

### 3. Add ESLint rule

```javascript
// packages/eslint-plugin/lib/rules/your-new-rule.js
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Detects your new vulnerability',
      category: 'Security',
    },
  },
  create(context) {
    return {
      Program(node) {
        const findings = analyze(routes, config);
        findings
          .filter(f => f.sink.kind === 'your-new-sink-kind')
          .forEach(f => context.report({ node: f.sink.node, message: f.message }));
      },
    };
  },
};
```

## Known v1 limitations

### 1. NestJS cross-service taint tracking

**What**: `this.ordersService.findOne(id)` calls are not followed.

**Why**: V1 scope limitation. Tracking taint across class boundaries requires:
- Resolving service injection (DI container analysis)
- Loading and parsing service class files
- Building a call graph across files
- Propagating taint through method calls

This is ~5x more complex than in-controller analysis.

**Workaround**: Inline service logic in controller for critical routes, or use `// eslint-disable-next-line`.

**Roadmap**: V2 will support cross-class taint tracking with DI-aware analysis.

### 2. Raw SQL string concatenation

**What**: `'SELECT * FROM users WHERE id = ' + userId` is flagged as "unanalyzable".

**Why**: V1 does not parse SQL strings. Proper detection would require:
- Full SQL parser (e.g., `node-sql-parser`)
- Tracking which parts of the concatenated string are tainted
- Understanding SQL syntax to identify injection points

This adds significant complexity and a large dependency.

**Workaround**: Use parameterized queries or template literals (which ARE analyzed).

**Roadmap**: V2 will use `node-sql-parser` for full SQL analysis.

### 3. Dynamic route registration

**What**: `app[method](path, handler)` where `method` is a variable.

**Why**: Static analysis cannot resolve runtime values. This is an inherent limitation of static analysis.

**Workaround**: Use explicit method calls (`app.get`, `app.post`).

**Roadmap**: No plans to support (impossible without runtime execution).

### 4. Conditional authentication

**What**: `if (isAdmin) { /* skip auth check */ }` may produce false positives.

**Why**: V1 does not track control flow branches. The engine sees:
- Route has tainted source
- Route has DB query
- Route may or may not have auth check (depends on branch)

Without control flow analysis, we assume the worst case.

**Workaround**: Use `// eslint-disable-next-line` with a comment explaining why it's safe.

**Roadmap**: V2 will have basic control flow analysis for common patterns.

### 5. AI agent limitations

**What**: AI may miss complex logic flaws or produce false positives.

**Why**: 2B parameter model has limited reasoning capacity. It cannot:
- Understand complex business logic
- Reason about multi-step attack chains
- Verify mathematical correctness

**Workaround**: Use AI as a second opinion, not primary detection. Always review AI findings manually.

**Roadmap**: V2 will support larger models (7B+) and ensemble voting (multiple models vote on findings).

---

**Made with Bob** 🤖
