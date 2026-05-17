# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Ask Mode Context — RouteGuard

### Non-obvious documentation patterns

- Ask mode is for understanding — do not modify files here
- For AST questions: always show the full node tree, not just the relevant subtree
- For visitor questions: always show the selector string alongside the function signature
- For security questions: reason through all three conditions (source, sink, guard)