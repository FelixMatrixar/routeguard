# RouteGuard — Complete Build Plan

> Backend-only static analysis. 8 deterministic rules + 6 AI-powered rules.
> Express + Fastify + NestJS. Prisma + Drizzle + TypeORM + Raw SQL.
> ESLint plugin + dashboard + MCP server + AI agent.
> Privacy-first: local Granite 3.3 2B via node-llama-cpp. No Ollama. Nothing sent to the cloud.

---

## Contents

1. [Product Overview](#product-overview)
2. [Bob Configuration Files](#bob-configuration-files) — create these before Phase 1
3. [Build Phases](#build-phases) — all 16 phases in sequence (Phase 0 → Phase 15 + unified package)
4. [Deployment](#deployment) — npm
5. [Quality Bars](#quality-bars)
6. [What Could Go Wrong](#what-could-go-wrong)
7. [Pitch](#pitch)

---

## Product Overview

### What it analyzes

Server-side Node.js code only — route handlers, ORM calls, database queries,
shell commands, file system operations. Not frontend React/Vue/Angular.

### The rules

**8 deterministic rules** — taint analysis, zero AI, offline, CI-safe:

| Rule | OWASP / CWE | Source → Sink | Guard Required |
|---|---|---|---|
| `no-bola` | API1 | route param/query → DB filter | ownership field in filter |
| `no-mass-assignment` | API3 | `req.body` → DB write | explicit field allowlist |
| `no-ssrf` | API7 | route param/query → outbound URL | allowlist check |
| `no-sql-injection` | CWE-89 | route param/query → raw SQL | parameterized query |
| `no-command-injection` | CWE-78 | route param/query → exec/spawn | execFile + args array |
| `no-path-traversal` | CWE-22 | route param/query → fs.* path | path.basename + boundary |
| `no-open-redirect` | CWE-601 | route param/query → res.redirect | allowlist check |
| `no-hardcoded-secrets` | CWE-798 | string literal → jwt.sign/crypto | process.env.X |

**6 AI-powered rules** — Granite 3.3 2B + ReAct agent, on-demand only, warning severity:

| Rule | OWASP | What it detects |
|---|---|---|
| Broken Authentication | API2 | Routes executing without identity verification |
| Broken Function Level Auth | API5 | Privileged routes without role/permission checks |
| Security Misconfiguration | API8 | Dangerous security middleware configs |
| Unsafe API Consumption | API10 | External API responses used without validation |
| Business Flow Abuse | API6 | Sensitive endpoints without abuse prevention |
| Inventory Drift | API9 | Versioned routes coexisting without deprecation |

### Supported stacks

**Frameworks:** Express, Fastify, NestJS
**ORMs:** Prisma, Drizzle, TypeORM, Raw SQL
**Surfaces:** eslint-plugin-routeguard · dashboard · MCP server

### Universal IR

The contract between all adapters and the detection engine.
Framework adapters produce `Route[]`. ORM adapters produce `Sink[]`.
The engine reads only IR — never imports from adapters or ORMs.

```ts
type SinkKind =
  | 'db-filter'        // → no-bola
  | 'db-write'         // → no-mass-assignment
  | 'outbound-url'     // → no-ssrf
  | 'raw-sql'          // → no-sql-injection
  | 'shell-exec'       // → no-command-injection
  | 'fs-path'          // → no-path-traversal
  | 'redirect-url'     // → no-open-redirect
  | 'hardcoded-secret' // → no-hardcoded-secrets

type Route = {
  framework: 'express' | 'fastify' | 'nestjs'
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  handlerNode: TSESTree.Node
  taintedSources: TaintedSource[]
  authContext: AuthContextRef | null
  sinks: Sink[]
}

type Sink = {
  kind: SinkKind
  orm?: 'prisma' | 'drizzle' | 'typeorm' | 'raw-sql'
  operation?: 'read' | 'write' | 'delete'
  model?: string
  filterKeys?: FilterKey[]
  taintedArg?: TSESTree.Node
  node: TSESTree.Node
}
```

⚠️ IR changes require updating ALL adapters and ALL ORM packages.
Never add optional fields to avoid updating adapters.

### Repo structure

```
routeguard/
├── .bob/
│   ├── custom_modes.yaml              # Four custom modes
│   ├── rules/general.md               # Rules for ALL modes
│   ├── rules-plan/
│   │   ├── AGENTS-plan.md
│   │   └── plan-rules.md
│   ├── rules-code/
│   │   ├── AGENTS-code.md
│   │   └── code-rules.md
│   ├── rules-ask/
│   │   ├── AGENTS-ask.md
│   │   └── ask-rules.md
│   └── rules-advanced/
│       └── AGENTS-advanced.md
├── packages/
│   ├── core/src/
│   │   ├── ir/types.ts                # Universal IR — the contract
│   │   ├── engine/index.ts
│   │   ├── sinks/                     # One file per rule
│   │   ├── taint/
│   │   └── config/schema.ts
│   ├── adapters/
│   │   ├── express/src/index.ts
│   │   ├── fastify/src/index.ts
│   │   └── nestjs/src/index.ts
│   ├── orms/
│   │   ├── prisma/src/index.ts
│   │   ├── drizzle/src/index.ts
│   │   ├── typeorm/src/index.ts
│   │   └── raw-sql/src/index.ts
│   ├── eslint-plugin/lib/
│   │   ├── rules/
│   │   └── index.js
│   ├── dashboard/src/
│   ├── mcp-server/src/
│   │   ├── index.ts
│   │   ├── server.ts
│   │   ├── tools/
│   │   └── agent/
│   │       ├── loop.ts
│   │       ├── tools.ts
│   │       ├── granite.ts             # node-llama-cpp client
│   │       └── knowledge/
│   └── cli/src/                       # Phase 16 — unified package
│       ├── index.ts                   # commander.js entry point
│       ├── commands/
│       │   ├── setup.ts               # download model
│       │   ├── doctor.ts              # verify all components
│       │   ├── analyze.ts
│       │   ├── dashboard.ts
│       │   └── mcp.ts
│       └── utils/
│           ├── download-model.ts      # HuggingFace GGUF download
├── examples/
│   ├── vulnerable-express/
│   ├── vulnerable-fastify/
│   ├── vulnerable-nestjs/
│   └── secure-mixed/
├── benchmark/
│   ├── runner.ts
│   ├── ground-truth.json
│   └── results/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DETECTION_RULES.md
│   ├── ADAPTER_GUIDE.md
│   ├── ORM_GUIDE.md
│   └── SINK_GUIDE.md
├── AGENTS.md
├── PLAN.md
└── README.md
```

---

## Bob Configuration Files

Create all files in this section before starting Phase 1.
Bob reads them automatically — no manual loading needed.

### First-time setup

```
1. Open project in Bob IDE
2. Run /init — Bob scans the repo and expands AGENTS.md
3. Create checkpoint — scroll up → "Restore Checkpoint"
4. Re-run /init after completing any phase or major structural change
```

### Custom modes — `.bob/custom_modes.yaml`

Four specialized modes. Switch with `/mode-slug` or the dropdown.

```yaml
customModes:
  - slug: ir-designer
    name: 📐 IR Designer
    roleDefinition: >-
      You are a programming language tooling architect specializing in intermediate
      representations. You design minimal, stable IR schemas for static analysis tools.
      You reason carefully about backward compatibility and keep IRs as small as possible.
    whenToUse: >-
      Use when designing or modifying packages/core/src/ir/types.ts.
      Any change here affects all adapters — use this mode before committing to a design.
    customInstructions: |-
      For every proposed IR field, ask: does the engine need this, or is it adapter-specific?
      When proposing changes, list every adapter and ORM that needs updating.
      Never add optional fields to avoid updating adapters — update the adapters instead.
    groups:
      - read
      - - edit
        - fileRegex: ^packages/core/src/ir/.*\.ts$
          description: IR type files only

  - slug: ast-explorer
    name: 🌳 AST Explorer
    roleDefinition: >-
      You are an expert in JavaScript/TypeScript Abstract Syntax Trees and the ESTree spec.
      You help developers understand AST node shapes, write @typescript-eslint/utils visitor
      patterns, and debug taint tracking logic. You never guess at AST shapes.
    whenToUse: >-
      Use before writing any ESLint visitor. Paste code, get the annotated AST,
      get the precise visitor selector. Also use for NestJS decorator AST mapping
      and for generating RuleTester test cases.
    customInstructions: |-
      Always annotate every node type when showing AST structures.
      Always explain why you chose a visitor selector and what it would NOT match.
      Always identify at least one false positive risk per visitor.
      Suggest astexplorer.net to verify when unsure of a node shape.
    groups:
      - read
      - - edit
        - fileRegex: \.(js|ts|json)$
          description: JS, TS, and config files only
      - command

  - slug: security-reviewer
    name: 🔒 Security Reviewer
    roleDefinition: >-
      You are an application security engineer specializing in OWASP API Security Top 10.
      You review static analysis detection logic for correctness and false positive risk.
      You distinguish syntactic pattern matching from semantic data flow analysis.
      You prefer precision over recall.
    whenToUse: >-
      Use after implementing a detection rule to review it for false positive risk.
      Use when writing DETECTION_RULES.md. Use to evaluate whether a test case
      represents a real vulnerability or an acceptable false negative.
    customInstructions: |-
      Always distinguish "this looks suspicious" from "this is definitely vulnerable."
      Flag any detection that assumes auth middleware naming conventions.
      Prefer precision over recall — one missed finding beats five false alarms.
    groups:
      - read
      - - edit
        - fileRegex: ^(packages/core/src/engine/|docs/).*
          description: Engine logic and documentation only

  - slug: dashboard-ui
    name: 🎨 Dashboard UI
    roleDefinition: >-
      You are a frontend engineer who builds dense, information-rich developer tool UIs.
      Terminal Brutalist aesthetic: monospace fonts, hard borders, semantic colors only,
      no decorative animations. You work with React, TypeScript, Tailwind, and Vite.
    whenToUse: >-
      Use for all work in packages/dashboard/. Do not use for plugin, adapter, or engine work.
    customInstructions: |-
      Every color must carry semantic meaning: safe=#00ff41, warning=#ffb800, critical=#ff3333.
      Information density over whitespace. No shadows, no gradients, no animations.
      Bundle size matters — this runs locally and must start fast.
    groups:
      - read
      - - edit
        - fileRegex: ^packages/dashboard/.*
          description: Dashboard package only
      - command
```

### General rules — `.bob/rules/general.md`

Loaded for ALL modes, every session.

```markdown
# General rules — all modes

## Monorepo awareness
- Always check which package a file belongs to before editing
- When a change in one package affects another, flag it before proceeding
- Read @/packages/core/src/ir/types.ts before touching any adapter or ORM file

## Communication
- For non-trivial tasks: state approach in 2-3 sentences and confirm before coding
- If task touches IR types: stop and confirm — wide blast radius
- If uncertain about false positive risk: say so explicitly, don't proceed silently

## File hygiene
- Never create files outside the established package structure without asking
- Never edit pnpm-lock.yaml
- Never edit examples/vulnerable-* — intentionally broken
```

### AGENTS.md (root) — placeholder for /init

```markdown
# RouteGuard — Project Context

> Run /init in Bob to regenerate this with a full project scan.
> Re-run after major structural changes.

## What this project is

RouteGuard is a backend-only static analysis tool (ESLint plugin) that detects
security vulnerabilities in Node.js backend code. Two layers:
1. Deterministic taint analysis — 8 rules, zero AI, CI-safe
2. AI-powered agent — 6 rules, Granite 3.3 2B via node-llama-cpp, on-demand only

## Stack
TypeScript strict, pnpm workspaces, ESLint @typescript-eslint/utils,
node-llama-cpp (Granite 3.3 2B) for AI layer

## Critical architecture rule
packages/core/src/ir/types.ts is the contract between all adapters and the engine.
Changes there require updating every adapter and ORM package. Never bypass it.

## Package purposes
- packages/core/ — IR types, detection engine, config
- packages/adapters/{express,fastify,nestjs}/ — framework AST → IR only
- packages/orms/{prisma,drizzle,typeorm,raw-sql}/ — ORM calls → Sink IR only
- packages/eslint-plugin/ — ESLint rule wiring
- packages/dashboard/ — local findings UI
- packages/mcp-server/ — MCP server + AI agent
- examples/vulnerable-*/ — intentionally broken, never auto-fix
- examples/secure-mixed/ — must always produce zero findings
```

### Plan mode rules — `.bob/rules-plan/plan-rules.md`

```markdown
# Plan mode rules

## Planning discipline
- Reference specific file paths, not vague layer descriptions
- Every plan must state: (1) which packages are affected, (2) whether IR changes, (3) what tests to write
- IR-touching steps must be marked ⚠️ IR CHANGE
- New adapters must follow the Express adapter as reference

## Output format
- Numbered steps with clear exit criteria per step
- "What could go wrong" section for NestJS or raw SQL work
- Do not produce code in Plan mode — produce plans only
```

### Code mode rules — `.bob/rules-code/code-rules.md`

```markdown
# Code mode rules

## Before writing code
- Read IR types before touching any adapter or engine file
- Read existing RuleTester cases before changing any ESLint rule

## TypeScript
- Strict mode is on — no `any` without a comment explaining why
- IR types use `type` not `interface`
- Adapter functions must be pure — IR production only, no side effects

## Testing
- Every new detection case needs a RuleTester invalid case
- Every safe pattern needs a RuleTester valid case
- No // TODO: add tests — write them now

## AST visitors
- Comment above every visitor with an example of the code it matches
- Selectors must be as specific as possible — broad selectors cause false positives
- Always handle undefined from TypeScript TypeChecker APIs
```

### Ask mode rules — `.bob/rules-ask/ask-rules.md`

```markdown
# Ask mode rules

- Ask mode is for understanding — do not modify files here
- For AST questions: always show the full node tree, not just the relevant subtree
- For visitor questions: always show the selector string alongside the function signature
- For security questions: reason through all three conditions (source, sink, guard)
```

### Advanced mode — `.bob/rules-advanced/AGENTS-advanced.md`

```markdown
# Advanced Mode Context — RouteGuard

## When to use Advanced mode
- Running the full test suite: pnpm test
- Building packages: pnpm build
- Running ESLint against examples to verify detection
- Publishing: npm publish
- Testing the MCP server manually

## Key commands
pnpm install                            # install all workspace deps
pnpm build                              # build all packages in order
pnpm test                               # run all tests
pnpm --filter @routeguard/core test     # single package
npx eslint examples/vulnerable-express  # test detection
routeguard setup                        # download Granite model (one-time, ~1.5GB)
routeguard doctor                       # verify model is present and loadable
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node packages/mcp-server/dist/index.js

## MCP + AI agent
The RouteGuard MCP server is available as a tool in Advanced mode.
Use it to analyze files during development:
- "Use RouteGuard to check @/packages/adapters/express/src/index.ts for vulnerabilities"
- "Analyze the vulnerable-express example and explain each finding"

## Safety
- Never run commands that modify examples/vulnerable-*
- Never git push without reviewing the diff first
- Never auto-approve destructive operations
```

### .bobignore

```
dist/
*.tsbuildinfo
node_modules/
pnpm-lock.yaml
.bob/checkpoints/

# DO NOT AUTO-FIX — intentionally vulnerable demo apps
examples/vulnerable-express/
examples/vulnerable-fastify/
examples/vulnerable-nestjs/

coverage/
*.log
```

### Mode selection reference

| Task | Mode | Why |
|---|---|---|
| Designing IR changes | `/ir-designer` | Locked to IR files only |
| Exploring AST shapes | `/ast-explorer` | Focused AST expertise |
| Writing adapter/engine code | `/code` | Standard implementation |
| Reviewing detection logic | `/security-reviewer` | False positive focus |
| Planning a phase | `/plan` | Read-only, markdown output |
| Running tests / building / MCP | `/advanced` | Full tool access |
| Writing documentation | `/ask` | Read-only, no accidents |
| Dashboard UI work | `/dashboard-ui` | Locked to dashboard package |

### Checkpoint strategy

Create checkpoints at:
1. Before Phase 1 — clean baseline
2. After IR types finalized — before any adapter work
3. After Phase 2 exit — Express + Prisma working end-to-end
4. Before Phase 6 — NestJS is the highest risk phase
5. After Phase 4 — all 8 deterministic rules passing
6. Before Phase 15 — before agent work
7. Before publishing — final state

---

## Build Phases

Each phase has a clear exit condition.
Do not move to the next phase until the exit condition is met.

---

### Phase 0 — Setup (before writing any code)

1. Open project in Bob IDE
2. Run `/init` — wait for Bob to scan and generate AGENTS files
3. Create first checkpoint
4. Switch to `/plan` mode and send:

```
@/packages/core/src/ir/types.ts
@/PLAN.md

I'm about to start Phase 1. Read the IR types and the build plan.
1. Are there any fields in the IR that the engine does NOT need?
2. Are there any fields MISSING required by all 8 rules?
3. Is the SinkKind union complete for the 8 rules in the plan?
Flag anything before I write a single line of code.
```

---

### Phase 1 — Core IR + Engine

**What:** Build the framework-agnostic skeleton. No AST work yet.

**Steps:**
1. Define all IR types in `packages/core/src/ir/types.ts`
2. Define all `SinkKind` values — one per rule
3. Write the config schema with defaults
4. Write the detection engine: `Route[]` + config → `Finding[]`
5. Unit test with handwritten IR fixtures — no adapters, no AST

**Mode:** `/ir-designer` for IR, `/code` for engine

**Step 1.1 — Finalize IR types**

Mode: `/ir-designer`
```
@/packages/core/src/ir/types.ts

Review the current IR schema for RouteGuard. This tool performs taint analysis
on Node.js backend code detecting 8 vulnerability types (no-bola, no-mass-assignment,
no-ssrf, no-sql-injection, no-command-injection, no-path-traversal, no-open-redirect,
no-hardcoded-secrets).

For each field in Route and Sink:
1. State whether the detection engine needs it or if it's adapter-specific
2. State whether removing it would break any of the 8 rules
3. Recommend keep or remove

Then confirm: is SinkKind complete? Is TaintSourceKind complete?
List any additions needed before I start building adapters.
```

**Checkpoint:** after IR is finalized — before any adapter work.

**Step 1.2 — Detection engine**

Mode: `/code`
```
@/packages/core/src/ir/types.ts
@/packages/core/src/engine/index.ts

Implement the detection engine for RouteGuard.
The engine takes Route[] and RouteGuardConfig, returns Finding[].

For each route, for each sink:
- no-bola: sink.kind === 'db-filter', any filterKey is tainted, none of the
  configured ownershipFields appears as an auth-context filterKey → finding
- no-mass-assignment: sink.kind === 'db-write', any filterKey in data is tainted,
  no allowlist check detected → finding
- no-ssrf/no-sql-injection/no-command-injection/no-path-traversal/no-open-redirect:
  sink has a taintedArg that traces back to a tainted source → finding
- no-hardcoded-secrets: sink.kind === 'hardcoded-secret', value is a string
  literal (not process.env.X) → finding

Write the complete engine implementation. Include JSDoc for every function.
Generate 3 unit test fixtures per rule: vulnerable, safe, edge case.
```

**Step 1.3 — Config schema**

Mode: `/code`
```
@/packages/core/src/ir/types.ts

Write the RouteGuardConfig TypeScript type and mergeConfig function.
Config options:
- ownershipFields: string[] — default ['userId', 'ownerId', 'authorId', 'accountId']
- authContext: { property: string, idField: string } — default { property: 'user', idField: 'id' }
- frameworks: Framework[] | 'auto' — default 'auto'
- ignoreRoutes: string[] — default ['/health', '/metrics', '/ping']
- testFilePatterns: string[] — default ['**/*.test.ts', '**/*.spec.ts']

Export defaultConfig and mergeConfig(partial) → RouteGuardConfig.
```

**Exit:** engine passes all 24 handwritten fixture cases (3 per rule × 8 rules).

---

### Phase 2 — Express Adapter (Reference Implementation)

**What:** Convert Express AST patterns into IR. Template for all other adapters.

**Mode:** `/ast-explorer` for AST questions, `/code` for implementation

**Step 2.1 — Understand the AST**

Mode: `/ast-explorer`
```
Show me the complete ESTree AST for this Express route. Annotate every node type
and every property. Do not skip any nodes.

app.get('/orders/:id', authenticate, async (req, res) => {
  const { id } = req.params
  const order = await prisma.order.findUnique({ where: { id } })
  res.json(order)
})

After showing the AST, write:
1. The visitor selector that matches this as an Express route registration
2. The logic to extract the path string '/orders/:id'
3. The logic to find the final handler function (last arg, skipping middleware)
4. The logic to resolve 'req' as the request parameter name
5. The logic to find { id } = req.params and mark 'id' as a tainted route-param source

For each piece of logic, show what it would NOT match and why.
```

**Step 2.2 — Implement**

Mode: `/code`
```
@/packages/core/src/ir/types.ts
@/packages/adapters/express/src/index.ts

Implement the Express framework adapter. Three functions required:

1. detectRouteCall(node: CallExpression) → { method, path } | null
   Matches: app.get/post/put/patch/delete and router.get/post/put/patch/delete
   Does NOT match: app.use(), app.listen(), other method calls

2. extractTaintedSources(handlerNode, reqParamName) → TaintedSource[]
   Finds: req.params.X → route-param, req.query.X → query-param, req.body.X → body-field
   Handles: both destructured and direct forms

3. extractAuthContext(handlerNode, reqParamName, authConfig) → AuthContextRef | null
   Finds: req.user.id (or configured equivalent)

Adapter must NOT contain detection logic. IR production only.
Include a comment above every visitor with example code it matches.
```

**Step 2.3 — Review**

Mode: `/security-reviewer`
```
@/packages/adapters/express/src/index.ts

Review this Express adapter for false positive risk.
For each function:
1. What legitimate code would incorrectly be flagged?
2. What vulnerable code would be missed?
3. Is the visitor selector tight enough?
```

**Exit:** Express adapter produces correct IR on `examples/vulnerable-express`.
Zero false positives on `examples/secure-mixed`.

---

### Phase 3 — Prisma ORM Adapter (Reference ORM)

**Mode:** `/ast-explorer` then `/code`

**Step 3.1 — Understand the AST**

Mode: `/ast-explorer`
```
Show me the complete ESTree AST for this Prisma call. Annotate every node.

const order = await prisma.order.findUnique({
  where: { id, userId: req.user.id }
})

Then show the AST for this nested where:
prisma.order.findFirst({ where: { AND: [{ id }, { userId: req.user.id }] } })

Write the visitor that:
1. Detects prisma.MODEL.METHOD() — extracts model name and method name
2. Finds the 'where' property in the first argument ObjectExpression
3. Returns each key in where with its value expression type
4. Handles nested AND/OR arrays by flattening to a list of FilterKey objects
```

**Step 3.2 — Implement**

Mode: `/code`
```
@/packages/core/src/ir/types.ts
@/packages/orms/prisma/src/index.ts

Implement the Prisma ORM adapter. Returns Sink IR.

Operations to detect:
- findUnique, findFirst, findMany → kind: 'db-filter', operation: 'read'
- update, updateMany, upsert → kind: 'db-write', operation: 'write'
- delete, deleteMany → kind: 'db-filter', operation: 'delete'
- create, createMany → kind: 'db-write', operation: 'write'

For db-filter: extract filterKeys from 'where'
For db-write: extract filterKeys from both 'where' AND 'data'
Classify each key's value: tainted / auth-context / literal / unknown
Handle nested where: AND/OR arrays must be flattened.
```

**Exit:** Express + Prisma end-to-end produces correct findings.
`no-bola` and `no-mass-assignment` work correctly.

---

### Phase 4 — Remaining Sinks (6 rules)

One sub-phase per sink. Pattern: `/ast-explorer` → `/code` → `/security-reviewer`.
**Checkpoint before each sub-phase.**

**4a — SSRF (`no-ssrf`)**

AST prompt:
```
Show me the AST for:
  const data = await axios.get(req.query.url)
  const result = await fetch(req.query.url)
  http.request({ hostname: req.params.host })

Write the visitor that detects each pattern and extracts the URL argument node.
Handle: const url = req.query.url; axios.get(url) — variable intermediary.
```

Code prompt:
```
@/packages/core/src/ir/types.ts

Implement the SSRF sink detector. Produces Sink with kind: 'outbound-url'.

HTTP clients to detect: axios, fetch, http.request, https.request, got, needle, node-fetch
Safe when: URL passes through an allowlist check before the call
Allowlist patterns: array.includes(url), allowedDomains.some(d => url.startsWith(d))
```

**4b — SQL Injection (`no-sql-injection`)**

AST prompt:
```
Show me the AST for:
  db.query(`SELECT * FROM users WHERE id = '${req.params.id}'`)
  pool.query('SELECT * FROM users WHERE id = ' + req.params.id)
  sql`SELECT * FROM users WHERE id = ${req.params.id}`

Write the visitor that detects SQL string injection.
Show the safe parameterized form and how to detect it as safe.
```

Code prompt:
```
@/packages/core/src/ir/types.ts

Implement the SQL injection sink detector. Produces Sink with kind: 'raw-sql'.

Detect: db.query, pool.query, connection.execute with tainted string args
Also detect: tagged template literals sql`...${taintedValue}...`
Safe when: parameterized query form (second argument is params array/object)
Use node-sql-parser for SQL string analysis. Do not write your own parser.
```

**4c — Command Injection (`no-command-injection`)**

AST prompt:
```
Show me the AST for:
  exec(`convert ${req.params.filename} output.pdf`)
  spawn('sh', ['-c', `echo ${req.query.input}`])
  execSync(req.body.cmd)

Show the safe form: execFile('convert', [req.params.filename, 'output.pdf'])
Explain how to distinguish exec(string) from execFile(string, array).
```

Code prompt:
```
@/packages/core/src/ir/types.ts

Implement the command injection sink detector. Produces Sink with kind: 'shell-exec'.

Detect: exec, execSync with tainted content; spawn('sh', ['-c', tainted])
Safe when: execFile(file, argsArray) or spawn(cmd, argsArray) without shell: true
```

**4d — Path Traversal (`no-path-traversal`)**

AST prompt:
```
Show me the AST for:
  fs.readFile(`./uploads/${req.params.filename}`, cb)
  fs.createReadStream(path.join('./uploads', req.query.file))

Show the safe form with path.basename() and explain how to detect it.
```

Code prompt:
```
@/packages/core/src/ir/types.ts

Implement the path traversal sink detector. Produces Sink with kind: 'fs-path'.

Detect: fs.readFile, fs.readFileSync, fs.writeFile, fs.writeFileSync,
        fs.unlink, fs.unlinkSync, fs.createReadStream, fs.createWriteStream, fs.stat

Safe when: tainted value passes through path.basename() before the fs call
```

**4e — Open Redirect (`no-open-redirect`)**

AST prompt:
```
Show me the AST for:
  res.redirect(req.query.returnUrl)
  res.redirect(301, req.params.url)

Show the safe form with allowlist. How to detect the status code overload?
```

Code prompt:
```
@/packages/core/src/ir/types.ts

Implement the open redirect sink detector. Produces Sink with kind: 'redirect-url'.

Detect: res.redirect(taintedUrl), res.redirect(statusCode, taintedUrl)
Safe when: URL passes through allowlist check before redirect
```

**4f — Hardcoded Secrets (`no-hardcoded-secrets`)**

AST prompt:
```
Show me the AST for:
  jwt.sign(payload, 'hardcoded-secret')
  crypto.createHmac('sha256', 'my-api-key')
  const apiKey = 'sk-prod-abc123'

Show safe form: jwt.sign(payload, process.env.JWT_SECRET)
How to detect string literal vs process.env.X?
```

Code prompt:
```
@/packages/core/src/ir/types.ts

Implement the hardcoded secrets detector. NOT taint analysis — AST pattern matching.
Produces Sink with kind: 'hardcoded-secret'.

Detect string literals in: jwt.sign, jwt.verify, crypto.createHmac,
crypto.createCipher, crypto.createDecipher second arguments.
Also detect: variable declarations where name matches /secret|password|token|key|api.?key/i
and value is a non-empty string literal (not process.env.X)

Skip files matching testFilePatterns config.
```

**Exit:** all 8 rules fire on planted bugs. Zero findings on `secure-mixed`.

---

### Phase 5 — Fastify Adapter

**Mode:** `/ast-explorer` then `/code`

```
@/packages/adapters/express/src/index.ts
@/packages/core/src/ir/types.ts

I'm implementing the Fastify adapter following the Express adapter as reference.
Key differences:
1. fastify.get('/path', async (request, reply) => {}) — 'request' not 'req'
2. fastify.route({ method: 'GET', url: '/path', handler: async (request, reply) => {} })
3. Options object may precede handler: fastify.get('/path', { schema }, handler)
4. Auth often in preHandler hooks — v1: handler scope only, do not analyze hooks

Show me the AST for each of these three forms.
Then write detectRouteCall, extractTaintedSources, extractAuthContext for Fastify,
following the same signatures as the Express adapter.
```

**Exit:** Fastify adapter reaches feature parity with Express.

---

### Phase 6 — NestJS Adapter (Hardest)

**Checkpoint before starting this phase.**

**Mode:** `/ast-explorer` for mapping (do this before writing any code), then `/code`

**Step 6.1 — Map the full AST**

Mode: `/ast-explorer`
```
Show me the complete ESTree AST for this NestJS controller.
Annotate EVERY node — especially decorator nodes.

@Controller('orders')
export class OrdersController {
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Query('include') include: string
  ) {
    return this.ordersService.findOne(id)
  }
}

Map each decorator to its exact node type and path in the tree.
Note: this.ordersService.findOne(id) is cross-service — do NOT follow it.
```

**Step 6.2 — Implement**

Mode: `/code`
```
@/packages/core/src/ir/types.ts
@/packages/adapters/express/src/index.ts

Implement the NestJS framework adapter. Follow the Express adapter structure.

Required:
1. Detect @Controller — extract base path
2. Detect @Get/@Post/@Put/@Patch/@Delete — extract method path
3. Combine controller base + method path → full route path
4. @Param('id') → route-param taint source
5. @Query('foo') → query-param taint source
6. @Body() → body-field taint source
7. @UseGuards(X) → auth middleware
8. @CurrentUser() → auth context (configurable decorator name)

V1 HARD LIMIT: when handler calls this.someService.method(),
do NOT follow into the service. Mark as unanalyzable. Document in code comment.
```

**Exit:** NestJS adapter works. Cross-service limitation documented in ARCHITECTURE.md.

---

### Phase 7 — Remaining ORM Adapters

**Mode:** `/ast-explorer` then `/code` for each

**Drizzle:**
```
@/packages/orms/prisma/src/index.ts
@/packages/core/src/ir/types.ts

Show me the AST for:
  db.select().from(orders).where(eq(orders.id, id))
  db.update(orders).set({ status }).where(eq(orders.id, id))

Implement the Drizzle adapter following the Prisma adapter as reference.
Walk the call chain to find .from() (table) and .where() (filter).
Parse eq(), and(), or(), ne() helpers to extract FilterKey objects.
```

**TypeORM:**
```
@/packages/orms/prisma/src/index.ts
@/packages/core/src/ir/types.ts

Show me the AST for both TypeORM API styles:
  repository.findOne({ where: { id: orderId } })
  createQueryBuilder('order').where('order.id = :id', { id: orderId }).getOne()

Implement the TypeORM adapter handling both styles.
Repository style follows Prisma pattern.
QueryBuilder style extracts parameters from .where() string + params object.
```

**Raw SQL:**
```
@/packages/core/src/ir/types.ts

Show me the AST for:
  db.query(`SELECT * FROM orders WHERE id = '${req.params.id}'`)
  pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id])
  sql`SELECT * FROM orders WHERE id = ${req.params.id}`

Implement the raw SQL adapter.
Use node-sql-parser — do not write a SQL parser.
Tagged template literals with tainted expressions → kind: 'raw-sql'.
String concatenation → flag as 'unanalyzable' (separate note).
Parameterized form (second arg is params) → safe.
```

**Exit:** all 4 ORMs work. Each has test fixtures.

---

### Phase 8 — ESLint Plugin Wiring

**Mode:** `/code`

**Step 8.1 — Wire rules**

```
@/packages/core/src/ir/types.ts
@/packages/eslint-plugin/lib/index.js

Implement the ESLint plugin wrapping the RouteGuard detection engine.
One rule per vulnerability: routeguard/no-bola, routeguard/no-mass-assignment,
routeguard/no-ssrf, routeguard/no-sql-injection, routeguard/no-command-injection,
routeguard/no-path-traversal, routeguard/no-open-redirect, routeguard/no-hardcoded-secrets.

Each rule:
1. Runs in a Program:exit visitor
2. Auto-detects framework from imports
3. Runs the appropriate adapter to produce Route IR
4. Runs appropriate ORM adapter(s) for Sink IR
5. Calls detection engine
6. Reports each Finding via context.report() with message and suggest

Export routeguard.configs.recommended with all 8 rules as 'error'.
```

**Step 8.2 — RuleTester cases**

```
@/packages/eslint-plugin/lib/rules/no-bola.js

Generate RuleTester test cases for routeguard/no-bola:
Valid (5): ownership check present, no dynamic params, ID from req.user.id,
           ownerId variant, Fastify equivalent
Invalid (5): findUnique with only id, update with only id, Fastify, NestJS,
             variable intermediary: const id = req.params.id; prisma.order.findUnique({ where: { id } })

Repeat for all 8 rules. Minimum 5 valid + 5 invalid per rule = 80+ total cases.
```

**Exit:** `npx eslint examples/vulnerable-express` shows all expected findings.
`npx eslint examples/secure-mixed` shows zero. All 80+ RuleTester cases pass.

---

### Phase 9 — Benchmark Suite

**Mode:** `/plan` to design, `/code` to implement, `/advanced` to run

**Step 9.1 — Design**

Mode: `/plan`
```
@/examples/vulnerable-express/
@/examples/secure-mixed/

Design the ground-truth JSON schema for the RouteGuard benchmark.
Requirements:
- Each entry: rule name, file path, line number, framework, orm
- Support "mustNotFire" entries for false positive testing
- Aggregation: per-rule, per-framework, per-ORM
- Calculates: precision, recall, F1 per rule

Write the benchmark runner that:
1. Runs eslint --format json on all example dirs
2. Loads ground-truth.json
3. Matches findings by rule + file + line (±1 line tolerance)
4. Outputs benchmark/results/report.md
```

**Step 9.2 — Run**

Mode: `/advanced`
```bash
pnpm build
node benchmark/runner.ts
```

Run Semgrep Node.js security rules on same examples for comparison.
Publish results in `benchmark/results/`.

**Exit:** benchmark runs cleanly. Precision ≥ 90% on all 8 rules.

---

### Phase 10 — Dashboard

**Mode:** `/dashboard-ui`

```
@/packages/dashboard/src/

Implement the RouteGuard findings dashboard.
Tech: Vite + React + TypeScript + Tailwind
Reads: eslint --format json output piped to a local file

Aesthetic: Terminal Brutalist
- Background: #0a0a0a, Safe: #00ff41, Warning: #ffb800, Critical: #ff3333
- Font: JetBrains Mono or similar monospace
- No shadows, no gradients, no animations

Five pages:
1. Overview — total routes, findings by rule, coverage %, framework breakdown
2. Findings — sortable table: rule | file | line | route | sink | suggestion
3. Route Map — every route with ✅/⚠️/❌ status, grouped by file/controller
4. Rules — all 8 rules with description, finding count, enable/disable toggle
5. Benchmark — if benchmark/results/report.md exists, show precision/recall table

Start command: routeguard dashboard
```

**Exit:** dashboard loads in < 2s with 1000+ findings. All 5 pages work.

---

### Phase 11 — Documentation

**Mode:** `/ask` for drafting (read-only, no accidental edits)

**README.md:**
```
@/packages/eslint-plugin/lib/index.js
@/docs/ARCHITECTURE.md

Write README.md. Sections:
1. One-line description
2. "What it detects" — all 8 deterministic rules + 6 AI rules
3. "Supported stacks" — frameworks and ORMs
4. "Quick start" — install, add to eslint.config.js, run
5. "AI features" — node-llama-cpp setup, Granite 3.3 2B, routeguard setup, ai_analyze_route
6. "Configuration" — every option with type, default, example
7. "CI/CD" — GitHub Actions example (deterministic only, not AI)
9. "Dashboard" — how to run
10. "MCP server" — install, Claude Desktop / Cursor 
11. "Benchmark results" — link to benchmark/results/
12. "Limitations" — NestJS cross-service, raw SQL concat, AI agent limits
13. "Roadmap" — v2 items
14. "Contributing" — adapter guide, ORM guide, sink guide links
```

**docs/ARCHITECTURE.md:**
```
@/packages/core/src/ir/types.ts
@/packages/adapters/express/src/index.ts

Write ARCHITECTURE.md. Sections:
1. Two-layer architecture: deterministic engine + AI agent
2. The taint analysis model — source → sink → guard with ASCII diagram
3. The Universal IR — why it exists, stability contract, all types explained
4. Package boundaries — table: package / produces / must not do
5. The AI agent layer — knowledge skills + ReAct loop + Granite 3.3 2B
6. Adding a framework — 5-step summary
7. Adding an ORM — 4-step summary
8. Adding a rule — 3-step summary
9. Known v1 limitations with rationale
```

**docs/DETECTION_RULES.md:**
```
@/packages/core/src/engine/index.ts

Write DETECTION_RULES.md. For each of the 8 rules, one section containing:
- What it detects (one sentence)
- The three-condition model: source / sink / guard
- 2 vulnerable code examples
- 2 safe code examples
- Known false positives (documented cases)
- Known false negatives (by design, with rationale)
- Configuration options
```

---

### Phase 12 — Release (ESLint Plugin)

See the **Deployment** section below for full step-by-step instructions.

**Summary:**
1. `npm publish` for `eslint-plugin-routeguard`
3. Update README with benchmark results
3. Tag release: `git tag eslint-plugin-v0.1.0`

---

### Phase 13 — AI Agent (Granite 3.3 2B + Knowledge Skills + ReAct)

**What:** A repo-agnostic security analysis agent built into the MCP server.
One new MCP tool: `ai_analyze_route`. Detects 6 OWASP rules deterministic
analysis cannot catch reliably.

**Model:** IBM Granite 3.3 2B via node-llama-cpp. Runs in-process inside Node.js.
No Ollama. No external server. No system binary. Just an npm dependency + a GGUF model file.

```bash
# One-time setup (run after npm install -g routeguard)
routeguard setup
# Downloads granite-3.3-2b-instruct-Q4_K_M.gguf (~1.5GB) from HuggingFace
# Stores in ~/.routeguard/models/ — shared across all projects
```

**Why this architecture:**

```
Knowledge skills (system prompt per rule)
  → what to look for, what counts as evidence, confidence calibration
  → security expertise encoded once, consistent across all repos

ReAct loop (self-directed investigation)
  → adapts to any project structure — no assumed conventions
  → uses search_code to find patterns regardless of folder layout
  → bounded at maxSteps (default: 10)

Granite 3.3 2B with think: true
  → semantic reasoning over assembled context
  → two call types: decision (short) and judgment (deep)
  → never decides investigation strategy — only judges evidence
```

**Package addition:**
```
packages/mcp-server/src/agent/
├── loop.ts          # ReAct loop (decision + judgment calls)
├── tools.ts         # read_file, list_directory, find_files, search_code,
│                    # resolve_import, find_symbol_definition, detect_framework
├── granite.ts       # node-llama-cpp client (think mode, temperature: 0.1)
└── knowledge/
    ├── broken-auth.ts       # API2 skill
    ├── function-auth.ts     # API5 skill
    ├── security-config.ts   # API8 skill
    ├── api-consumption.ts   # API10 skill
    ├── business-flow.ts     # API6 skill
    └── inventory.ts         # API9 skill
```

**The new MCP tool:**
```ts
ai_analyze_route({
  filePath: string          // route file to analyze
  route?: string            // specific route e.g. 'GET /orders/:id'
  rules?: AIRuleName[]      // default: all 6 AI rules
  projectRoot?: string      // default: cwd
  maxSteps?: number         // default: 10, max: 15
}) → {
  findings: AIFinding[]
  stepsUsed: number
  durationMs: number
  modelUsed: string
  modelReady: boolean       // false → graceful degradation, no error
}

type AIFinding = {
  rule: AIRuleName
  route: string
  confidence: 'high' | 'medium' | 'low'
  severity: 'warning'       // always warning, never error
  evidence: string
  reasoning: string
  suggestedReview: string
}
```

**The key agnosticism tool — `search_code`:**

Instead of assuming auth lives in `middleware/auth.js`, the agent searches
for JWT verification patterns wherever they live in the project:
```ts
search_code('jwt.verify')     // finds auth implementations anywhere
search_code('@UseGuards')     // finds NestJS guards anywhere
search_code('req.user')       // finds auth context usage anywhere
```

Uses ripgrep if available, falls back to TypeScript glob + fs.readFile.
Warns at startup if ripgrep is not installed.

**The ReAct loop:**

```ts
async function reactLoop(goal, knowledgeSkill, initialContext, tools, maxSteps = 10) {
  let steps = 0, accumulated = initialContext

  while (steps < maxSteps) {
    steps++

    // Decision call (short, ~400 tokens): do I have enough? what next?
    const decision = await granite.think({ systemPrompt: knowledgeSkill,
      userPrompt: buildDecisionPrompt(goal, accumulated), maxTokens: 400 })

    if (decision.action === 'CONCLUDE') {
      // Judgment call (longer, ~600 tokens): is this vulnerable?
      return await granite.think({ systemPrompt: knowledgeSkill,
        userPrompt: buildJudgmentPrompt(goal, accumulated), maxTokens: 600 })
    }

    const result = await executeTool(decision.tool, decision.args)
    accumulated.evidence.push({ tool: decision.tool, result })
  }

  return { confidence: 'low', reasoning: 'Step cap reached — project too complex' }
}
```

**Knowledge skills (full content for each rule):**

**API2 — Broken Authentication** (`knowledge/broken-auth.ts`):
```
You are a security engineer analyzing Node.js API routes for broken authentication.

WHAT COUNTS AS AUTHENTICATION EVIDENCE:
- A function that validates JWT, session cookie, or API key before handler
- @Auth, @Protected, @UseGuards, @Authenticated, @RequireAuth decorators
- Early return with HTTP 401/403 if no valid identity found
- passport.authenticate(), jwt.verify(), session validation calls
- Middleware accessing req.user, req.principal that returns 401 if absent

WHAT DOES NOT COUNT:
- Input validation, rate limiting, logging, body parsing, CORS middleware

WHEN FOLLOWING IMPORTS:
Read the implementation of any auth-suspicious function. Look for:
JWT verification, session lookup, API key validation, OAuth token verification.

CONFIDENCE LEVELS:
- high: directly read the auth implementation and confirmed behavior
- medium: found strong signals but couldn't fully verify
- low: couldn't fully trace the middleware chain

OUTPUT (JSON only):
{ "hasAuthentication": boolean|null, "confidence": "high"|"medium"|"low",
  "evidence": string, "reasoning": string, "missingGuard": string }
```

**API5 — Broken Function Level Authorization** (`knowledge/function-auth.ts`):
```
You are a security engineer analyzing broken function level authorization.

SIGNALS A ROUTE IS PRIVILEGED:
- Path contains: /admin, /internal, /superuser, /staff, /management, /moderator
- Route changes user roles, permissions, account status, or system config
- Route accesses data belonging to other users

WHAT COUNTS AS A ROLE CHECK:
- req.user.role === 'admin', user.isAdmin, hasPermission(), canDo(), checkRole()
- permissionService.verify(), authz.check(), policy.enforce()
- @Roles('admin'), @Permissions('manage:users'), @RequireRole('staff')
- @UseGuards(AdminGuard), @UseGuards(RoleGuard)
- Early return with 403 if role check fails

WHAT DOES NOT COUNT:
- Authentication checks (that's API2)
- Ownership checks (that's BOLA, already covered by deterministic rules)

OUTPUT (JSON only):
{ "hasRoleCheck": boolean|null, "confidence": "high"|"medium"|"low",
  "evidence": string, "reasoning": string, "missingGuard": string }
```

**API8 — Security Misconfiguration** (`knowledge/security-config.ts`):
```
You are a security engineer auditing Node.js security middleware configuration.

KNOWN DANGEROUS PATTERNS (always flag):
- cors({ origin: '*' }) with credentials: true
- cors({ origin: '*' }) on an authenticated API
- helmet({ contentSecurityPolicy: false })
- helmet({ frameguard: false })
- jwt.sign(payload, secret, { algorithm: 'none' })
- session({ secret: shortLiteralNotFromEnv })
- Cookie without httpOnly: true or secure: true (sensitive cookies)
- No rate limiting on /login, /register, /reset-password

HOW TO INVESTIGATE:
Find app initialization file → find security middleware calls →
for inline configs evaluate directly → for abstracted configs read the builder function.

OUTPUT (JSON only):
{ "misconfigurations": [{ "type": string, "description": string, "location": string,
  "severity": "high"|"medium", "suggestedFix": string }],
  "confidence": "high"|"medium"|"low", "reasoning": string }
```

**API10 — Unsafe API Consumption** (`knowledge/api-consumption.ts`):
```
You are a security engineer analyzing unsafe consumption of third-party APIs.

WHAT COUNTS AS UNSAFE:
- response.data.role flows into user update or permission check
- response.data.isAdmin used without type checking
- External response body used in DB write without schema validation

WHAT COUNTS AS VALIDATION:
- z.parse(), yup.validate(), joi.validate(), ajv.validate()
- typeof checks, instanceof checks with validation
- Response schema from type-safe OpenAPI client

HOW TO INVESTIGATE:
Find HTTP client calls to external URLs → trace response data usage →
look for validation between response and security-sensitive usage →
read any validation function implementations found.

OUTPUT (JSON only):
{ "hasUnsafeConsumption": boolean|null, "confidence": "high"|"medium"|"low",
  "evidence": string, "reasoning": string,
  "unsafeUsages": [{ "location": string, "issue": string }] }
```

**API6 — Business Flow Abuse** (`knowledge/business-flow.ts`):
```
You are a security engineer identifying sensitive business flows lacking abuse prevention.

SENSITIVE FLOW SIGNALS (path contains):
/checkout, /payment, /order, /purchase, /subscribe, /register, /signup,
/redeem, /coupon, /voucher, /referral, /trial, /activate, /reset-password,
/forgot-password, /verify-email, /send-otp, /resend

WHAT COUNTS AS ABUSE PREVENTION:
- Rate limiting middleware on this route or globally
- CAPTCHA integration (recaptcha, hcaptcha, turnstile)
- DB uniqueness constraint (unique index on email, code, etc.)
- Token-based one-time use
- IP-based throttling

If the endpoint is NOT a sensitive flow, return hasSensitiveFlow: false and stop.

OUTPUT (JSON only):
{ "hasSensitiveFlow": boolean, "hasAbusePrevention": boolean|null,
  "confidence": "high"|"medium"|"low", "flowType": string,
  "evidence": string, "reasoning": string, "missingPrevention": string }
```

**API9 — Inventory Drift** (`knowledge/inventory.ts`):
```
You are a security engineer auditing API inventory management.

PATTERNS TO FLAG:
- /api/v1/resource and /api/v2/resource both active without deprecation headers
- No Deprecation, Sunset, or Link headers on older version routes
- Routes with debug, test, internal, temp in their path
- Version numbers that skip: v1 exists, v3 exists, no v2

HOW TO INVESTIGATE:
Collect all route paths → group by resource and version →
check for deprecation handling → look for OpenAPI spec files →
flag routes suggesting test/debug artifacts.

OUTPUT (JSON only):
{ "issues": [{ "type": "version-coexistence"|"undocumented"|"version-skip"|"debug-artifact",
  "routes": string[], "description": string, "severity": "high"|"medium"|"low" }],
  "confidence": "high"|"medium"|"low", "reasoning": string }
```

**Granite client (`agent/granite.ts`):**

```ts
import { getLlama, LlamaChatSession } from 'node-llama-cpp'
import { homedir } from 'os'
import { join } from 'path'

const MODEL_PATH = join(homedir(), '.routeguard', 'models',
  'granite-3.3-2b-instruct-Q4_K_M.gguf')

let session: LlamaChatSession | null = null

export async function isModelReady(): Promise<boolean> {
  const { existsSync } = await import('fs')
  return existsSync(MODEL_PATH)
}

async function getSession(): Promise<LlamaChatSession> {
  if (session) return session

  const llama = await getLlama()
  const model = await llama.loadModel({ modelPath: MODEL_PATH })
  const context = await model.createContext({ contextSize: 8192 })
  session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt: '',           // set per-call via newSession()
  })
  return session
}

export async function think(params: {
  systemPrompt: string
  userPrompt: string
  maxTokens: number
}): Promise<string> {
  // Each analysis call gets a fresh session to avoid context bleed
  const llama = await getLlama()
  const model = await llama.loadModel({ modelPath: MODEL_PATH })
  const context = await model.createContext({ contextSize: 8192 })
  const callSession = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt: params.systemPrompt,
  })

  return await callSession.prompt(params.userPrompt, {
    maxTokens: params.maxTokens,
    temperature: 0.1,     // low — security judgments need consistency
  })
}
```

**Notes:**
- Fresh context per call prevents reasoning from one route bleeding into the next
- `contextSize: 8192` is conservative — fits in 8GB RAM alongside the model weights
- The model loads once per MCP server process — subsequent calls reuse the loaded weights
- Thinking mode is part of the Granite 3.3 2B chat template — node-llama-cpp applies it automatically via the model's built-in template
```

**Performance on 8GB CPU:**

| Scenario | Agent steps | Granite calls | Time |
|---|---|---|---|
| Simple conventional route | 3-5 | 1-2 | 30-60s |
| One import to follow | 5-7 | 2-3 | 60-120s |
| Deep import chain | 8-10 | 3-4 | 2-4 min |

On-demand only. Never automatic. Never in CI.

**Bob prompts for Phase 15:**

Step 13.1 — Understand node-llama-cpp (mode: `/ask`):
```
I'm implementing an AI inference client using node-llama-cpp to run
IBM Granite 3.3 2B locally for security code analysis.

The model is a GGUF file stored at ~/.routeguard/models/granite-3.3-2b-instruct-Q4_K_M.gguf
It runs inside my Node.js MCP server process — no external server, no Ollama.

Explain:
1. How to load a GGUF model with getLlama() and loadModel() from node-llama-cpp
2. How to create a context and a LlamaChatSession with a system prompt
3. How to call session.prompt() with maxTokens and temperature options
4. How Granite 3.3 2B's thinking mode works via the model's chat template
5. How to handle fresh context per call to prevent reasoning bleed between routes
6. Memory implications: model weights (~1.5GB) loaded once, context created per call
```

Step 13.2 — Implement ReAct loop (mode: `/code`):
```
@/packages/mcp-server/src/agent/granite.ts
@/packages/core/src/ir/types.ts

Implement the ReAct agent loop for RouteGuard security analysis.

Input: goal, knowledgeSkill, initialContext, tools, maxSteps (default 10)

Each iteration:
1. Decision prompt (max 400 tokens): enough context? if not, what next?
2. Parse: { action: 'TOOL'|'CONCLUDE', tool?, args? }
3. If TOOL: execute, append result to evidence, continue
4. If CONCLUDE: judgment call (max 600 tokens)
5. If MAX_STEPS: return { confidence: 'low', reasoning: 'step cap reached' }

Context management: summarize evidence when it exceeds 2000 tokens.
Never include full file contents more than once — reference by filename after first read.
```

Step 13.3 — Implement knowledge skills (mode: `/code`):
```
@/packages/mcp-server/src/agent/loop.ts

The knowledge skills are defined in agent/knowledge/*.ts as string constants.

Implement the skill dispatcher:
1. Takes a rule name (API2 | API5 | API6 | API8 | API9 | API10)
2. Returns the correct knowledge skill system prompt
3. Returns the output schema for parsing Granite's JSON response
4. Returns a human-readable finding message template

Write a JSON parser per skill that converts Granite's output to AIFinding.
Always wrap parsing in try/catch — retry once with stricter prompt on failure.
On second failure return { confidence: 'low', error: 'unparseable response' }.
```

Step 13.4 — Implement search_code (mode: `/code`):
```
Implement the search_code agent tool.

search_code(query, options: { filePattern?, rootDir?, maxResults? })

1. Use ripgrep (rg) if available — fastest
2. Fall back to TypeScript glob + string search if rg not available
3. Return: Array<{ file: string, line: number, snippet: string (3 lines context) }>

Handle: regex queries, plain strings, file pattern filtering, maxResults cap (default 20).
Detect ripgrep availability at module load. Log warning if absent.
```

Step 13.5 — Wire ai_analyze_route tool (mode: `/code`):
```
@/packages/mcp-server/src/server.ts
@/packages/mcp-server/src/agent/loop.ts

Implement the ai_analyze_route MCP tool handler.

Input (zod validated): filePath, route?, rules?, projectRoot?, maxSteps?

Handler:
1. Check model ready with isModelReady() — if false return { modelReady: false }
2. Read the route file as initial context
3. For each requested rule: load skill → run ReAct loop → parse finding
4. Return AIFinding[] with metadata

Log each agent step to stderr (not stdout — that's MCP protocol).
Record durationMs per rule and total.
```

Step 13.6 — Integration test (mode: `/advanced`):
```bash
# Verify model is present
routeguard doctor

pnpm --filter @routeguard/mcp-server build

echo '{
  "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": {
    "name": "ai_analyze_route",
    "arguments": {
      "filePath": "examples/vulnerable-express/app.js",
      "route": "GET /orders/:id",
      "rules": ["API2", "API5"]
    }
  }
}' | node packages/mcp-server/dist/index.js
```

**Exit:**
- [ ] `ai_analyze_route` registered and callable from Claude Desktop
- [ ] All 6 knowledge skills produce valid JSON from Granite 3.3 2B
- [ ] ReAct loop correctly caps at maxSteps and returns low confidence
- [ ] `search_code` works with both ripgrep and fallback
- [ ] Agent correctly identifies missing auth in `examples/vulnerable-express`
- [ ] Agent finds no issues on `examples/secure-mixed`
- [ ] Model not found → graceful `{ modelReady: false }` with setup instructions
- [ ] All AI findings are `severity: 'warning'` — never `'error'`
- [ ] Agent never modifies any file
- [ ] `routeguard doctor` correctly reports model status

---

### Phase 14 — Unified Package + Setup Wizard

**What:** One npm package (`routeguard`) that bundles everything — the ESLint plugin,
the MCP server, the AI agent, the dashboard, and a CLI with setup and doctor commands.
One install, one setup command, everything works.

**The user experience:**

```bash
npm install -g routeguard
routeguard setup
```

```
RouteGuard Setup

✓ node-llama-cpp ready (bundled — no install needed)

Downloading Granite 3.3 2B Instruct Q4_K_M...
Source: huggingface.co/ibm-granite/granite-3.3-2b-instruct-GGUF
Size:   1.47 GB
████████████████████░░ 89% (1.31GB / 1.47GB) — 2m 14s remaining

✓ Model saved to ~/.routeguard/models/granite-3.3-2b-instruct-Q4_K_M.gguf


✓ Setup complete

  Deterministic rules (8)  active in ESLint + MCP
  AI rules (6)             active via: routeguard analyze --ai
                                        MCP tool: ai_analyze_route

Run 'routeguard doctor' at any time to verify your setup.
```

**CLI commands:**

```bash
routeguard setup              # download Granite model (one-time)
routeguard doctor             # verify model + ESLint plugin
routeguard analyze <path>     # run deterministic rules on a file/dir
routeguard analyze --ai <path>  # run all 14 rules (slow, on-demand)
routeguard dashboard          # launch local dashboard UI
routeguard mcp                # start MCP server (for manual testing)
```

**Package structure:**

```
packages/cli/
├── src/
│   ├── index.ts               # CLI entry point (commander.js)
│   ├── commands/
│   │   ├── setup.ts           # download model
│   │   ├── doctor.ts          # verify everything is working
│   │   ├── analyze.ts         # run analysis from CLI
│   │   ├── dashboard.ts       # launch dashboard
│   │   └── mcp.ts             # start MCP server
│   └── utils/
│       ├── download-model.ts  # HuggingFace GGUF download with progress
└── package.json
```

**`packages/cli/package.json`:**
```json
{
  "name": "routeguard",
  "version": "0.1.0",
  "bin": { "routeguard": "dist/index.js" },
  "description": "OWASP API security analysis for Node.js backends",
  "keywords": ["security", "OWASP", "eslint", "mcp", "BOLA", "IDOR"],
  "files": ["dist/"],
  "dependencies": {
    "eslint-plugin-routeguard": "workspace:*",
    "routeguard-mcp": "workspace:*",
    "node-llama-cpp": "^3.0.0",
    "commander": "^12.0.0",
    "ora": "^8.0.0",
    "chalk": "^5.0.0"
  }
}
```

**Model download (`utils/download-model.ts`):**

```ts
const MODEL_URL =
  'https://huggingface.co/ibm-granite/granite-3.3-2b-instruct-GGUF/' +
  'resolve/main/granite-3.3-2b-instruct-Q4_K_M.gguf'

const MODEL_DIR  = join(homedir(), '.routeguard', 'models')
const MODEL_PATH = join(MODEL_DIR, 'granite-3.3-2b-instruct-Q4_K_M.gguf')

export async function downloadModel(onProgress: (pct: number) => void): Promise<void> {
  mkdirSync(MODEL_DIR, { recursive: true })

  const response = await fetch(MODEL_URL)
  const total = Number(response.headers.get('content-length'))
  let received = 0

  const writer = createWriteStream(MODEL_PATH)
  for await (const chunk of response.body!) {
    writer.write(chunk)
    received += chunk.length
    onProgress(Math.round((received / total) * 100))
  }
  writer.end()
}
```

**Doctor command:**

```bash
routeguard doctor
```

```
RouteGuard Doctor

node-llama-cpp      ✓ v3.x.x
Model file          ✓ ~/.routeguard/models/granite-3.3-2b-instruct-Q4_K_M.gguf (1.47GB)
Model loadable      ✓ loaded in 4.2s, context OK
ESLint plugin       ✓ eslint-plugin-routeguard v0.1.0
MCP server          ✓ routeguard-mcp v0.1.0

All systems go. Run 'routeguard analyze <path>' to start.
```

**Bob prompts for Phase 14:**

Step 14.1 — Design CLI (mode: `/plan`):
```
I'm building a unified CLI for RouteGuard that bundles:
- eslint-plugin-routeguard (workspace package)
- routeguard-mcp (workspace package)
- node-llama-cpp (for local AI inference)
- A setup wizard that downloads Granite 3.3 2B from HuggingFace

Design the CLI command structure using commander.js.
Commands: setup, doctor, analyze, analyze --ai, dashboard, mcp.

For the setup command, design the flow:
1. Check node-llama-cpp is installed (it's bundled — should always be true)
2. Check if model file exists at ~/.routeguard/models/
3. If not: download from HuggingFace with progress bar
What edge cases should setup handle?
What should doctor verify and in what order?
```

Step 14.2 — Implement model download (mode: `/code`):
```
@/packages/cli/src/utils/download-model.ts

Implement the HuggingFace GGUF model download utility.

URL: https://huggingface.co/ibm-granite/granite-3.3-2b-instruct-GGUF/resolve/main/granite-3.3-2b-instruct-Q4_K_M.gguf
Destination: ~/.routeguard/models/granite-3.3-2b-instruct-Q4_K_M.gguf

Requirements:
- Stream download (do not load 1.5GB into memory)
- Report progress via callback: (received: number, total: number) → void
- Resume partial downloads if the file exists but is incomplete
  (check file size vs Content-Length header)
- Verify the download with a simple size check after completion
- Handle network errors gracefully with a clear retry message
```

Step 14.3 — Implement setup command (mode: `/code`):
```
@/packages/cli/src/commands/setup.ts

Implement the routeguard setup command using ora for spinners and chalk for colors.

Flow:
1. Check node-llama-cpp importable → ✓ (always bundled)
2. Check model file exists → if yes: "Model already present, skipping download"
3. If not: show download progress bar, call downloadModel()
4. Verify model loadable: call getLlama().loadModel() briefly
5. Print summary: what's active, what's next

Use ora spinners for each step. Green checkmark on success, yellow warning on skip,
red X on failure (but don't exit — continue to next step).
```

Step 14.4 — Implement doctor command (mode: `/code`):
```
@/packages/cli/src/commands/doctor.ts

Implement routeguard doctor. Checks everything and reports status.

Checks in order:
1. node-llama-cpp version
2. Model file exists at expected path + correct size
3. Model actually loadable (getLlama().loadModel() — timeout after 10s)
4. ESLint plugin importable (require('eslint-plugin-routeguard'))
6. MCP server buildable (check dist/index.js exists)

Each check: name (padded) + ✓/✗/⚠ + detail
Exit code 0 if all pass, 1 if any fail.
```

**`packages/cli/package.json` publish:**

```bash
npm pack --dry-run --workspace=packages/cli
npm publish --workspace=packages/cli --access public
git tag cli-v0.1.0 && git push origin cli-v0.1.0
```

**Exit:**
- [ ] `npm install -g routeguard` installs everything
- [ ] `routeguard doctor` correctly verifies all components
- [ ] `routeguard analyze examples/vulnerable-express` shows findings
- [ ] `routeguard analyze --ai examples/vulnerable-express/app.js` triggers AI agent
- [ ] Model already present → setup skips download cleanly
- [ ] Partial download → setup resumes correctly

---

## Deployment

### Part 1 — npm (eslint-plugin-routeguard)

**`packages/eslint-plugin/package.json`:**
```json
{
  "name": "eslint-plugin-routeguard",
  "version": "0.1.0",
  "description": "Static BOLA/IDOR and injection vulnerability detector for Node.js backends",
  "main": "lib/index.js",
  "keywords": ["eslint", "eslint-plugin", "security", "OWASP", "BOLA", "IDOR",
    "injection", "taint-analysis", "express", "fastify", "nestjs"],
  "peerDependencies": { "eslint": ">=8.0.0" },
  "files": ["lib/"],
  "license": "MIT"
}
```

```bash
npm login
cd packages/eslint-plugin
npm pack --dry-run          # always dry-run first
npm publish --access public

# Subsequent versions
npm version patch            # 0.1.0 → 0.1.1
npm publish
```

**GitHub Actions** (`.github/workflows/publish-npm.yml`):
```yaml
name: Publish to npm
on:
  push:
    tags: ['eslint-plugin-v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build --workspace=packages/eslint-plugin
      - run: npm publish --workspace=packages/eslint-plugin --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Part 3 — npm (routeguard-mcp)

```json
{
  "name": "routeguard-mcp",
  "version": "0.1.0",
  "bin": { "routeguard-mcp": "dist/index.js" },
  "keywords": ["mcp", "model-context-protocol", "security", "OWASP", "claude", "cursor"],
  "files": ["dist/"]
}
```

```bash
npm pack --dry-run --workspace=packages/mcp-server
npm publish --workspace=packages/mcp-server --access public
git tag mcp-v0.1.0 && git push origin mcp-v0.1.0
```

### Versioning strategy

Four packages version independently. Publish with git tags:

```bash
git tag eslint-plugin-v0.1.0 && git push origin eslint-plugin-v0.1.0
git tag mcp-v0.1.0           && git push origin mcp-v0.1.0
git tag cli-v0.1.0           && git push origin cli-v0.1.0
```

### Part 4 — npm (routeguard CLI)

The CLI package depends on all other workspace packages.
Build and publish last, after all others are published.

```bash
# Update workspace deps to point to published versions, not workspace:*
# Then:
npm pack --dry-run --workspace=packages/cli
npm publish --workspace=packages/cli --access public
```

**GitHub Actions** (`.github/workflows/publish-cli.yml`):
```yaml
name: Publish CLI
on:
  push:
    tags: ['cli-v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build --workspace=packages/cli
      - run: npm publish --workspace=packages/cli --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## Quality Bars

Do not ship until all are true.

**Deterministic engine (Phases 1-8):**
- [ ] Zero false positives on `examples/secure-mixed` for all 8 rules
- [ ] All planted vulnerabilities caught in all 3 vulnerable examples
- [ ] Benchmark precision ≥ 90% for all 8 rules
- [ ] All 80+ RuleTester cases pass
- [ ] All 3 framework adapters have integration tests
- [ ] All 4 ORM adapters have integration tests

**Surfaces (Phases 9-14):**
- [ ] Dashboard loads in < 2s with 1000+ findings. All 5 pages work

- [ ] All 6 deterministic MCP tools work correctly in Claude Desktop
- [ ] `analyze_file` findings match `npx eslint` findings on same file
- [ ] `routeguard-mcp` npx invocation works without pre-install

**AI agent (Phase 15):**
- [ ] `ai_analyze_route` correctly identifies missing auth in vulnerable examples
- [ ] `ai_analyze_route` produces no false positives on `examples/secure-mixed`
- [ ] All 6 knowledge skills produce valid JSON from Granite 3.3 2B
- [ ] Model not found → graceful `{ modelReady: false }`, no crash, clear setup instructions
- [ ] Agent never exceeds maxSteps without returning a result
- [ ] All AI findings are `severity: 'warning'` — never `'error'`
- [ ] Agent never modifies any file

**Unified package (Phase 16):**
- [ ] `npm install -g routeguard` installs without errors
- [ ] `routeguard setup` downloads model with progress bar
- [ ] `routeguard doctor` correctly verifies all components and exits with code 1 on failure
- [ ] `routeguard analyze` produces same findings as `npx eslint` on same file
- [ ] Partial download resumes correctly on second `routeguard setup`

**Documentation and release:**
- [ ] All doc files complete per the spec in Phase 12
- [ ] README has an honest Limitations section (incl. AI agent limits)
- [ ] npm dry-run shows only correct files for all 3 packages

---

## What Could Go Wrong

**NestJS cross-service taint.** Do not follow `this.service.method()`. In-controller
analysis only. Document clearly. It's a research problem — don't attempt it.

**Raw SQL parser edge cases.** Use `node-sql-parser`. Never write your own.
String concatenation → `unanalyzable` flag, not a confirmed injection finding.

**IR breaks during NestJS.** Use `/ir-designer` mode + checkpoint before Phase 6.
Revise intentionally — never add optional fields to avoid updating adapters.

**Drizzle chain walking.** Build a chain-flattening utility before sink detection.

**Hardcoded secrets in test files.** `testFilePatterns` config handles this.
Implement it in Phase 1 config schema, not as an afterthought.

**Dashboard scope creep.** Five pages, no more. No AI panel. No real-time watching.

**MCP tool output too large.** `analyze_directory` on a large project could return
thousands of findings. Add `maxFindings` option (default 100) with a `summary` field.

**Granite JSON parsing failures.** Wrap every Granite response parse in try/catch.
On failure, retry once with stricter prompt ("respond ONLY with valid JSON, no other text").
On second failure return `{ confidence: 'low', error: 'unparseable response' }`. Never crash.

**Agent step cap too low.** Deep monorepos can exhaust 10 steps. Make `maxSteps`
configurable (default 10, max 15). Document that complex repos may need higher.

**search_code missing ripgrep.** TypeScript fallback is 10-20x slower on large codebases.
Detect at startup and warn: `"RouteGuard AI works best with ripgrep (brew install ripgrep)"`.

**node-llama-cpp memory pressure on 8GB.** The model weights (~1.5GB) load once at
MCP server startup. Context creation per call adds ~200-400MB. On 8GB machines with
many browser tabs and editor windows, this can cause OOM. Mitigate by loading the model
lazily (only on first `ai_analyze_route` call, not at server startup) and unloading after
60 seconds of inactivity. Document memory requirements clearly: "AI features require ~2GB
free RAM. Close browser tabs if experiencing slowness."

**Granite inference slow on CPU.** 30-60 seconds per Granite call with thinking mode.
Ensure `ai_analyze_route` is never triggered automatically. Add warning in README:
"AI analysis takes 1-5 minutes per route on CPU. GPU acceleration reduces this to 5-15s."

**HuggingFace download rate limiting.** The model download in `routeguard setup` hits
HuggingFace CDN. On slow connections or with rate limiting, the download may fail
partway through. Always implement resume logic (check existing file size vs Content-Length).

**Knowledge skill prompt drift.** If you edit a knowledge skill after testing,
re-run all Phase 15 integration tests. Small prompt changes break JSON parsing downstream.

**npm publish before testing.** Always dry-run first. Always test in a clean directory.


---

## Pitch

> *"Snyk scans your dependencies. Semgrep matches your patterns.
> RouteGuard catches what both miss — the logic flaws in your own code.
> Eight deterministic rules covering BOLA, mass assignment, SSRF, SQL injection,
> command injection, path traversal, open redirect, and hardcoded secrets.
> Six AI-powered rules using Granite 3.3 2B — runs entirely in your Node.js process,
> no external server, no Ollama, nothing sent to the cloud.
> One install. One setup command. Everything works.
> Caught at write-time. Works offline. Nothing leaves your machine."*
