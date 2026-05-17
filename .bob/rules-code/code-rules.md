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