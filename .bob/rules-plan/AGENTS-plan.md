# Plan Mode Context — RouteGuard

> Generated placeholder. Run `/init` to expand with full project scan.

## Planning constraints

- Any plan touching `packages/core/src/ir/types.ts` must list every downstream
  package that needs updating — mark these steps with ⚠️ IR CHANGE
- Plans must specify exact file paths, not vague layer descriptions
- Every plan must include what `RuleTester` cases need to be added

## Phase order to respect

1. Core IR + engine (no adapters yet)
2. Express adapter + Prisma ORM (reference implementations)
3. Fastify adapter
4. NestJS adapter (hardest — do last)
5. Drizzle, TypeORM, raw SQL ORMs
6. ESLint plugin wiring
7. VS Code extension
8. Dashboard

Never plan a new adapter before the IR has been validated by the previous one.

## NestJS-specific planning notes

Cross-service taint tracking is out of scope for v1. Any plan involving NestJS
must explicitly state this limitation and document it in the output.

## Raw SQL planning notes

Only tagged template literals and parameterized `db.query()` calls are in scope.
Dynamic SQL via string concatenation → flag as "unanalyzable", not a BOLA finding.
