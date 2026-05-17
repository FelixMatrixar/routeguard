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