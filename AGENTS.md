# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## What RouteGuard is

Backend-only static analysis tool (ESLint plugin) detecting BOLA vulnerabilities in Node.js.
Two layers: (1) Deterministic taint analysis — 8 rules, zero AI, CI-safe
(2) AI-powered agent — 6 rules, Granite 3.3 2B via node-llama-cpp, on-demand only

## Critical architecture rule

`packages/core/src/ir/types.ts` is the contract between ALL adapters and the engine.
Changes there require updating every adapter and ORM package. Never bypass it.

## Non-obvious package purposes

- `packages/adapters/*` — framework AST → IR only (NO detection logic)
- `packages/orms/*` — ORM calls → Sink IR only (NO framework knowledge)
- `examples/vulnerable-*` — intentionally broken, NEVER auto-fix
- `examples/secure-mixed` — must ALWAYS produce zero findings (regression test)

## Stack

TypeScript strict mode, pnpm workspaces, ESLint @typescript-eslint/utils, node-llama-cpp