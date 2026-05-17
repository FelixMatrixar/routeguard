# RouteGuard Architecture

## Detection model

A BOLA vulnerability exists when ALL THREE are true:

1. **Tainted source** — user-controlled ID enters the handler (route param, query param, body)
2. **Sensitive sink** — that ID reaches a DB filter clause (WHERE, findUnique, etc.)
3. **Missing guard** — the same filter does NOT include an ownership field tied to `req.user.id`

## The Universal IR

All framework adapters convert their AST into the same IR shape (`Route`, `Sink`).
The detection engine reads only IR — it never imports from adapters or ORMs.
This is what makes multi-framework support tractable: adding Hono means writing one adapter, not touching the engine.

```
Express/Fastify/NestJS code
         ↓
Framework Adapter → Route IR (with embedded Sink IR from ORM adapter)
         ↓
Detection Engine (IR only)
         ↓
Finding[] → ESLint diagnostics
```

## Package boundaries

| Package | Produces | Must NOT |
|---|---|---|
| `packages/core` | IR types, Finding[] | Import from adapters/ORMs |
| `packages/adapters/*` | Route IR | Contain detection logic |
| `packages/orms/*` | Sink IR | Know about frameworks |
| `packages/eslint-plugin` | ESLint rule | Bypass IR |

## Adding a framework (v2+)

1. `packages/adapters/{name}/src/index.ts`
2. Implement `detectRouteCall`, `extractTaintedSources`, `extractAuthContext`
3. Return `Route[]` using IR types from `@routeguard/core`
4. Add `examples/vulnerable-{name}/`
5. Register in `packages/eslint-plugin`

~200–400 lines. Zero engine changes.

## Known v1 limitations

- **NestJS**: cross-service taint not tracked (in-controller only)
- **Raw SQL**: string concatenation flagged as "unanalyzable", not BOLA
- **Dynamic routes**: `app[method](path, handler)` not detected
- **Conditional auth**: `if (isAdmin)` branches may produce false positives
