# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Code Mode Context — RouteGuard

### File structure Bob should know before editing

Before touching any adapter or ORM file, read:
- `packages/core/src/ir/types.ts` — the IR contract
- `packages/core/src/config/schema.ts` — what config options exist

### Naming conventions

- IR types: `type` keyword, not `interface`
- Adapter functions: `detect*`, `extract*` prefix
- ORM functions: `detect*Sink` prefix
- Test files: `*.test.ts` inside `tests/` per package

### Code patterns to follow

- Express adapter is the reference implementation for all other adapters
- Prisma adapter is the reference implementation for all other ORMs
- All visitor functions must be pure — no side effects
- Every `context.report()` call needs both `message` and `suggest`

### Never do

- `any` type without a comment explaining why
- Edit files in `examples/vulnerable-*`
- Add detection logic inside adapters (belongs in engine only)
- Add framework knowledge inside ORM packages