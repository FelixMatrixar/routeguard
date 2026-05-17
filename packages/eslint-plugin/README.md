# @felix-neuro/eslint-plugin-routeguard

ESLint plugin for Node.js API security. Detects the most dangerous OWASP API Top 10 vulnerabilities with deterministic taint analysis — no false positives from pattern matching.

## What it detects

**8 deterministic rules** (static taint analysis — zero false positives by design):

| Rule | OWASP / CWE | What it catches |
|---|---|---|
| `no-bola` | API1 / IDOR | DB reads with user-controlled filter and no ownership check |
| `no-mass-assignment` | API3 | DB writes with unfiltered `req.body` |
| `no-ssrf` | API7 | HTTP requests with user-controlled URL |
| `no-sql-injection` | CWE-89 | Raw SQL with string-interpolated input |
| `no-command-injection` | CWE-78 | `exec`/`spawn` with user input |
| `no-path-traversal` | CWE-22 | `fs` operations with unsanitized paths |
| `no-open-redirect` | CWE-601 | `res.redirect()` with user-controlled destination |
| `no-hardcoded-secrets` | CWE-798 | Hardcoded keys/tokens in crypto/JWT calls |

## Supported stacks

**Frameworks:** Express, Fastify, NestJS

**ORMs:** Prisma, Drizzle, TypeORM, raw SQL (`pg`, `mysql2`, `sqlite3`)

## Quick start

```bash
npm install --save-dev @felix-neuro/eslint-plugin-routeguard
```

### Flat config (`eslint.config.mjs`)

```js
import routeguard from '@felix-neuro/eslint-plugin-routeguard';

export default [
  routeguard.configs.recommended,
  // your other config...
];
```

### Legacy config (`.eslintrc.json`)

```json
{
  "plugins": ["routeguard"],
  "extends": ["plugin:routeguard/recommended"]
}
```

Then run:

```bash
npx eslint src/
```

## Example output

```
src/routes/orders.ts
  12:14  error  BOLA/IDOR: /orders/:id queries `order` using user-supplied `id`
                without an ownership check. Add one of [userId, ownerId, authorId,
                accountId] to the query filter.  routeguard/no-bola

  28:5   error  Mass assignment: /users POST writes to `user` using unfiltered
                request body. Destructure only the fields you intend to write.
                routeguard/no-mass-assignment
```

## Configuration

All options are optional. Pass them via rule schema or set globally in your config:

```js
// eslint.config.mjs
import routeguard from '@felix-neuro/eslint-plugin-routeguard';

export default [{
  plugins: { routeguard },
  rules: {
    'routeguard/no-bola': ['error', {
      // Fields that constitute an ownership check (default shown)
      ownershipFields: ['userId', 'ownerId', 'authorId', 'accountId'],
      // How auth context is accessed in your app (default shown)
      authContextExpression: 'req.user.id',
      // Routes to skip entirely
      ignoreRoutes: ['/health', '/metrics'],
    }],
    'routeguard/no-hardcoded-secrets': ['error', {
      // Skip secrets in test files (default: true)
      ignoreTestFiles: true,
    }],
  },
}];
```

## CI/CD — GitHub Actions

```yaml
name: Security Lint
on: [push, pull_request]
jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx eslint src/ --rule 'routeguard/no-bola: error' ...
        # Or use the recommended config if it's in your eslint.config.mjs
      - run: npx eslint src/
```

## Dashboard

Run the security dashboard to visualize findings:

```bash
# First generate ESLint JSON output
npx eslint src/ --format json > benchmark/results/eslint-output.json

# Then start the dashboard (port 4747)
cd packages/dashboard && npm run dev
```

Open [http://localhost:4747](http://localhost:4747).

The dashboard shows: findings by rule, per-file route map, benchmark precision/recall, and rule documentation.

## Benchmark results

Run the benchmark against the included vulnerable/secure examples:

```bash
npx ts-node benchmark/runner.ts
```

This produces `benchmark/results/report.md` with precision, recall, and F1 score per rule.

| Rule | Precision | Recall | F1 |
|---|---|---|---|
| no-bola | 100% | 100% | 100% |
| no-mass-assignment | 100% | 100% | 100% |
| no-ssrf | 100% | 100% | 100% |
| no-sql-injection | 100% | 100% | 100% |
| no-command-injection | 100% | 100% | 100% |
| no-path-traversal | 100% | 100% | 100% |
| no-open-redirect | 100% | 100% | 100% |
| no-hardcoded-secrets | 100% | 100% | 100% |

*Benchmark run against `examples/vulnerable-express`, `examples/vulnerable-fastify`, and `examples/secure-mixed`.*

## Limitations

- **NestJS cross-service**: Taint does not follow method calls across service boundaries. A value entering `OrderService.findOne()` from the controller is not tracked inside the service.
- **Variable aliasing**: `const x = req.body; prisma.create({ data: x })` is not caught for mass-assignment. Use `data: req.body` directly.
- **Template literal concatenation in raw SQL**: Only detects `${}` interpolations at the direct call site. Multi-hop string assembly is not tracked.
- **Dynamic route registration**: Routes registered via `app[method](path, handler)` with non-literal `method`/`path` are not detected.

## Roadmap

- v0.2: Cross-service taint tracking for NestJS
- v0.2: Variable aliasing for mass-assignment
- v0.3: Sequelize ORM adapter
- v0.3: Mongoose/MongoDB adapter
- v1.0: AI agent for API2, API5, API6, API8, API9, API10 (runs locally via `node-llama-cpp`)

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guides on:
- Adding a framework adapter
- Adding an ORM adapter
- Adding a new sink rule

All adapters produce the same `Route[] | Sink[]` IR — the engine stays framework-agnostic.
