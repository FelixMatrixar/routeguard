# Ask Mode Context — RouteGuard

> Generated placeholder. Run `/init` to expand with full project scan.

## What Ask mode is used for in this project

- Understanding AST node shapes before writing visitors
- Exploring how a specific framework (Express, Fastify, NestJS) expresses
  routes in its AST
- Understanding TypeScript TypeChecker APIs before using them
- Clarifying the three-condition BOLA detection model
- Reviewing what a detection finding should say and why

## Key concepts to understand well

**The three BOLA conditions:**
1. Tainted source — user-controlled ID enters handler
2. Sensitive sink — that ID reaches a DB filter
3. Missing guard — no ownership field (userId, ownerId etc.) in same filter

**The IR contract:**
Ask mode can read but must not modify `packages/core/src/ir/types.ts`.
Understanding this file is essential before working on any adapter.

## When asking about AST shapes

Always ground the answer in a minimal code example. Show the full node tree,
not just the relevant subtree. Explain why the selector is specific enough
to avoid false positives.
