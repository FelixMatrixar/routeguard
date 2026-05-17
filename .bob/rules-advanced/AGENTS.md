# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Advanced Mode Context — RouteGuard

### Non-obvious commands

```bash
# Run single package tests (not obvious from root package.json)
pnpm --filter @routeguard/core test

# Test detection by running ESLint on vulnerable examples
npx eslint examples/vulnerable-express

# AI model setup (one-time, downloads ~1.5GB Granite 3.3 2B)
routeguard setup
routeguard doctor  # verify model loaded

# Test MCP server manually
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node packages/mcp-server/dist/index.js
```

### MCP + AI agent

The RouteGuard MCP server is available as a tool in Advanced mode.
Use it to analyze files during development:
- "Use RouteGuard to check @/packages/adapters/express/src/index.ts for vulnerabilities"
- "Analyze the vulnerable-express example and explain each finding"

### Safety rules

- Never run commands that modify `examples/vulnerable-*` (intentionally broken)
- Never git push without reviewing the diff first
- Never auto-approve destructive operations