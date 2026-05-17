# RouteGuard

OWASP API security analysis for Node.js backends — deterministic ESLint rules + AI agent + MCP server.

```
npm install -g @felix-neuro/routeguard
routeguard analyze ./src
```

---

## What it does

RouteGuard scans your Express, Fastify, or NestJS codebase for the most critical API security vulnerabilities using two complementary engines:

| Engine | How | Rules |
|--------|-----|-------|
| **Deterministic** | Taint-analysis via ESLint | BOLA, mass-assignment, SSRF, SQL injection, command injection, path traversal, open redirect, hardcoded secrets |
| **AI agent** | IBM Granite 3.3 2B (runs locally, offline) | Broken auth, function-level authz, business flow abuse, security misconfig, API inventory, unsafe API consumption |

No cloud, no API keys, no data leaves your machine.

---

## Installation

```bash
npm install -g @felix-neuro/routeguard
```

Node.js 18+ required.

---

## Commands

### `routeguard analyze <path>`

Run the deterministic security scanner on a file or directory.

```bash
routeguard analyze ./src
routeguard analyze ./src/routes/users.ts
```

Options:

| Flag | Description |
|------|-------------|
| `--ai` | Also run the AI agent (requires model — run `setup` first) |
| `--rules <list>` | Comma-separated AI rules: `API2,API5,API6,API8,API9,API10` |
| `--project-root <dir>` | Root for resolving imports (default: `cwd`) |

```bash
# Deterministic only (fast, ~1s)
routeguard analyze ./src

# Deterministic + all AI rules
routeguard analyze ./src --ai

# Deterministic + specific AI rules
routeguard analyze ./src/routes/auth.ts --ai --rules API2,API5
```

---

### `routeguard setup`

Download the IBM Granite 3.3 2B model (~1.5 GB, one-time). Required for `--ai` analysis.

```bash
routeguard setup
```

The model is saved to `~/.routeguard/models/` and reused across projects.

---

### `routeguard doctor`

Check that all RouteGuard components are installed and working.

```bash
routeguard doctor
```

Example output:

```
RouteGuard Doctor

✓ node-llama-cpp      3.2.1
✗ Model file          not found — run: routeguard setup
⚠ Model loadable      skipped — model file not ready
✓ ESLint plugin       @felix-neuro/eslint-plugin-routeguard v0.1.1
✓ MCP server          /path/to/mcp-server.js
```

---

### `routeguard dashboard`

Launch a local web dashboard to browse findings from your last scan.

```bash
routeguard dashboard
routeguard dashboard --port 8080
```

First run `analyze` and save JSON output for the dashboard to read:

```bash
npx eslint ./src --format json > public/eslint-output.json
routeguard dashboard
```

---

### `routeguard mcp`

Start the RouteGuard MCP server for use with Claude Desktop, Cursor, or VS Code.

```bash
routeguard mcp
```

Add to your Claude Desktop `config.json`:

```json
{
  "mcpServers": {
    "routeguard": {
      "command": "routeguard",
      "args": ["mcp"]
    }
  }
}
```

The MCP server exposes two tools:
- `analyze_file` — run deterministic ESLint analysis on any file
- `ai_analyze_route` — run the Granite AI agent on a specific route

---

## Rules reference

### Deterministic rules (always available)

| Rule | OWASP | What it catches |
|------|-------|-----------------|
| `no-bola` | API1 | Object-level auth — user-supplied IDs used without ownership check |
| `no-mass-assignment` | API3 | `req.body` spread directly into ORM create/update calls |
| `no-ssrf` | API7 | User-controlled URLs passed to `fetch`, `axios`, `http.request` |
| `no-sql-injection` | — | String-concatenated queries in Knex/pg/mysql raw calls |
| `no-command-injection` | — | User input in `exec`, `spawn`, `execSync` |
| `no-path-traversal` | — | Tainted paths in `fs.readFile`, `fs.writeFile`, `path.join` |
| `no-open-redirect` | — | Unvalidated user input in `res.redirect` |
| `no-hardcoded-secrets` | — | API keys, tokens, passwords as string literals |

### AI rules (requires `routeguard setup`)

| Rule | OWASP | What it checks |
|------|-------|----------------|
| `API2` | API2:2023 | Broken authentication — missing JWT/session validation |
| `API5` | API5:2023 | Function-level authorization — admin routes without role guards |
| `API6` | API6:2023 | Business flow abuse — sensitive actions without rate limiting |
| `API8` | API8:2023 | Security misconfiguration — CORS, helmet, cookie flags |
| `API9` | API9:2023 | Improper inventory — multiple API versions, debug routes |
| `API10` | API10:2023 | Unsafe API consumption — external response data used without validation |

---

## Use with ESLint directly

Install just the ESLint plugin if you only want the deterministic rules:

```bash
npm install --save-dev @felix-neuro/eslint-plugin-routeguard eslint
```

**Flat config** (`eslint.config.mjs`):

```js
import routeguard from '@felix-neuro/eslint-plugin-routeguard';

export default [
  routeguard.configs.recommended,
  { files: ['src/**/*.{js,ts}'] },
];
```

**Legacy config** (`.eslintrc.json`):

```json
{
  "plugins": ["@felix-neuro/routeguard"],
  "extends": ["plugin:@felix-neuro/routeguard/recommended"]
}
```

---

## CI/CD

```yaml
# .github/workflows/security.yml
- name: RouteGuard security scan
  run: |
    npx @felix-neuro/routeguard analyze ./src
```

---

## Limitations

- **Backend only** — does not analyze frontend code (React, Vue, etc.)
- **Node.js only** — Express, Fastify, NestJS; not Go/Python/Ruby
- **Taint analysis is intra-file** — cross-file data flows are not tracked
- **AI rules are probabilistic** — always review findings before acting
- **Granite model** requires ~4 GB RAM and takes 1–4 minutes per file

---

## License

MIT © [FelixMatrixar](https://github.com/FelixMatrixar)
