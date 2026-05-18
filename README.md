# RouteGuard

Static analysis tool for detecting API security vulnerabilities in Node.js backends — zero runtime overhead, CI-ready.

## What it detects

### 8 Deterministic Rules (Zero AI)
1. **no-bola** — Broken Object Level Authorization (OWASP API1:2023)
2. **no-mass-assignment** — Broken Object Property Level Authorization (OWASP API3:2023)
3. **no-ssrf** — Server-Side Request Forgery (OWASP API7:2023)
4. **no-sql-injection** — SQL Injection (CWE-89)
5. **no-command-injection** — Command Injection (CWE-78)
6. **no-path-traversal** — Path Traversal (CWE-22)
7. **no-open-redirect** — Open Redirect (CWE-601)
8. **no-hardcoded-secrets** — Hardcoded Secrets (CWE-798)

### 6 AI-Powered Rules (Optional, On-Demand)
9. **ai-detect-auth-bypass** — Authentication bypass patterns
10. **ai-detect-rate-limit** — Missing rate limiting
11. **ai-detect-input-validation** — Insufficient input validation
12. **ai-detect-sensitive-data** — Sensitive data exposure
13. **ai-detect-crypto-misuse** — Cryptographic misuse
14. **ai-detect-logic-flaws** — Business logic vulnerabilities

## Supported stacks

### Frameworks
- ✅ **Express** — Full support
- ✅ **Fastify** — Full support
- ✅ **NestJS** — V1 limitation: in-controller analysis only (no cross-service taint tracking)
- 🔜 **Hono** — Planned for v2
- 🔜 **Koa** — Planned for v2

### ORMs
- ✅ **Prisma** — Full support
- ✅ **Drizzle** — Full support
- ✅ **TypeORM** — Repository API + QueryBuilder API
- ✅ **Raw SQL** — Template literals, parameterized queries, tagged templates
- 🔜 **Mongoose** — Planned for v2
- 🔜 **Sequelize** — Planned for v2

## Quick start

### Installation

```bash
npm install --save-dev @routeguard/eslint-plugin
# or
pnpm add -D @routeguard/eslint-plugin
```

### Configuration

Add to your `eslint.config.js` (ESLint 9+ flat config):

```js
import routeguard from '@routeguard/eslint-plugin';

export default [
  {
    plugins: {
      routeguard,
    },
    rules: {
      'routeguard/no-bola': 'error',
      'routeguard/no-mass-assignment': 'error',
      'routeguard/no-ssrf': 'error',
      'routeguard/no-sql-injection': 'error',
      'routeguard/no-command-injection': 'error',
      'routeguard/no-path-traversal': 'error',
      'routeguard/no-open-redirect': 'error',
      'routeguard/no-hardcoded-secrets': 'warn',
    },
    settings: {
      routeguard: {
        ownershipFields: ['userId', 'ownerId', 'tenantId'],
        authContext: {
          property: 'user',
          idField: 'id',
        },
      },
    },
  },
];
```

For ESLint 8 (`.eslintrc.js`):

```js
module.exports = {
  plugins: ['@routeguard'],
  rules: {
    '@routeguard/no-bola': 'error',
    '@routeguard/no-mass-assignment': 'error',
    // ... other rules
  },
  settings: {
    routeguard: {
      ownershipFields: ['userId', 'ownerId'],
      authContext: { property: 'user', idField: 'id' },
    },
  },
};
```

### Run

```bash
npx eslint src/
```

## AI features

RouteGuard's AI layer uses **Granite 3.3 2B** via `node-llama-cpp` for on-demand deep analysis. The AI agent runs locally — no API keys, no cloud calls.

### Setup

1. **Install node-llama-cpp**:
   ```bash
   npm install node-llama-cpp
   ```

2. **Download Granite 3.3 2B model**:
   ```bash
   npx routeguard setup
   ```
   This downloads the GGUF model (~1.5GB) to `~/.routeguard/models/`.

3. **Enable AI rules** in your ESLint config:
   ```js
   rules: {
     'routeguard/ai-analyze-route': 'warn',
   },
   settings: {
     routeguard: {
       ai: {
         enabled: true,
         modelPath: '~/.routeguard/models/granite-3.3-2b.gguf',
         maxTokens: 2048,
       },
     },
   },
   ```

### Usage

AI analysis is **opt-in per route** via comment directive:

```typescript
// @routeguard-ai-analyze
app.get('/orders/:id', async (req, res) => {
  // AI agent will analyze this entire route handler
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
  });
  res.json(order);
});
```

The AI agent:
- Reads the route handler AST
- Applies 6 specialized detection skills
- Uses ReAct loop for multi-step reasoning
- Reports findings as ESLint warnings

**Performance**: ~2-5 seconds per route on M1 Mac. Run only on changed files in CI.

## Configuration

All options with defaults:

```typescript
{
  routeguard: {
    // Ownership fields checked in BOLA detection
    ownershipFields: string[];
    // Default: ['userId', 'ownerId', 'tenantId', 'organizationId']

    // Auth context configuration
    authContext: {
      property: string;  // Default: 'user'
      idField: string;   // Default: 'id'
    },
    // Matches: req.user.id, request.user.id, etc.

    // NestJS-specific: custom auth decorator name
    nestjs?: {
      authDecoratorName: string;  // Default: 'CurrentUser'
    },

    // Routes to ignore (regex patterns)
    ignoreRoutes: string[];
    // Default: ['^/health$', '^/metrics$', '^/api-docs']

    // Severity level
    severity: 'error' | 'warning';
    // Default: 'error'

    // AI configuration (optional)
    ai?: {
      enabled: boolean;           // Default: false
      modelPath: string;          // Path to GGUF model
      maxTokens: number;          // Default: 2048
      temperature: number;        // Default: 0.1 (deterministic)
      contextWindow: number;      // Default: 8192
    },
  }
}
```

### Example: Multi-tenancy setup

```js
settings: {
  routeguard: {
    ownershipFields: ['tenantId', 'workspaceId'],
    authContext: {
      property: 'session',
      idField: 'tenantId',
    },
  },
},
```

This will check for `req.session.tenantId` in all DB filters.

### Example: NestJS with custom decorator

```js
settings: {
  routeguard: {
    nestjs: {
      authDecoratorName: 'GetUser',  // Matches @GetUser() decorator
    },
    authContext: {
      property: 'user',
      idField: 'sub',  // JWT subject claim
    },
  },
},
```

## CI/CD

### GitHub Actions (Deterministic rules only)

```yaml
name: Security Scan
on: [push, pull_request]

jobs:
  routeguard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      
      - run: pnpm install
      
      - name: Run RouteGuard
        run: pnpm eslint src/ --format json --output-file routeguard-results.json
        continue-on-error: true
      
      - name: Upload results
        uses: actions/upload-artifact@v4
        with:
          name: routeguard-results
          path: routeguard-results.json
      
      - name: Fail on errors
        run: |
          if grep -q '"severity":2' routeguard-results.json; then
            echo "Security vulnerabilities found!"
            exit 1
          fi
```
### Available tools

The MCP server exposes:
- `scan_route` — Analyze a specific route
- `list_vulnerabilities` — Get all findings
- `suggest_fix` — Generate fix for a vulnerability
- `explain_rule` — Explain a detection rule

## Benchmark results

See [benchmark/results/](benchmark/results/) for detailed performance metrics.

**Summary** (tested on M1 MacBook Pro, 16GB RAM):

| Project | LOC | Routes | Findings | Scan Time | Memory |
|---------|-----|--------|----------|-----------|--------|
| Express API | 5K | 42 | 8 | 1.2s | 120MB |
| NestJS App | 15K | 127 | 23 | 3.8s | 280MB |
| Fastify Service | 8K | 68 | 12 | 1.9s | 150MB |

**AI analysis** (per route): 2-5 seconds, 400MB peak memory

## Limitations

### V1 Known Limitations

1. **NestJS cross-service taint tracking**
   - **What**: `this.ordersService.findOne(id)` calls are not followed
   - **Why**: V1 scope — in-controller analysis only
   - **Workaround**: Inline service logic in controller for critical routes
   - **Roadmap**: V2 will support cross-class taint tracking

2. **Raw SQL string concatenation**
   - **What**: `'SELECT * FROM users WHERE id = ' + userId` is flagged as "unanalyzable"
   - **Why**: V1 does not parse SQL strings (would need full SQL parser)
   - **Workaround**: Use parameterized queries or template literals
   - **Roadmap**: V2 will use `node-sql-parser` for full SQL analysis

3. **Dynamic route registration**
   - **What**: `app[method](path, handler)` where `method` is a variable
   - **Why**: Static analysis cannot resolve runtime values
   - **Workaround**: Use explicit method calls (`app.get`, `app.post`)
   - **Roadmap**: No plans to support (inherent static analysis limitation)

4. **Conditional authentication**
   - **What**: `if (isAdmin) { /* skip auth check */ }` may produce false positives
   - **Why**: V1 does not track control flow branches
   - **Workaround**: Use `// eslint-disable-next-line` for known safe cases
   - **Roadmap**: V2 will have basic control flow analysis

5. **AI agent limitations**
   - **What**: AI may miss complex logic flaws or produce false positives
   - **Why**: 2B parameter model has limited reasoning capacity
   - **Workaround**: Use AI as a second opinion, not primary detection
   - **Roadmap**: V2 will support larger models (7B+) and ensemble voting

## Contributing

We welcome contributions! See guides:

- [Adding a framework adapter](docs/guides/ADDING_FRAMEWORK.md)
- [Adding an ORM adapter](docs/guides/ADDING_ORM.md)
- [Adding a detection rule](docs/guides/ADDING_RULE.md)

### Quick links
- [Architecture overview](docs/ARCHITECTURE.md)
- [Detection rules reference](docs/DETECTION_RULES.md)
- [IR types documentation](packages/core/src/ir/types.ts)

### Development setup

```bash
git clone https://github.com/routeguard/routeguard.git
cd routeguard
pnpm install
pnpm build
pnpm test
```

### Running examples

```bash
# Scan vulnerable examples
pnpm eslint examples/vulnerable-express/
pnpm eslint examples/vulnerable-nestjs/

# Should produce zero findings
pnpm eslint examples/secure-mixed/
```

## License

MIT © RouteGuard Team

---

**Made with Bob** 🤖
