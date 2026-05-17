# Advanced Mode Context — RouteGuard

## When to use Advanced mode
- Running the full test suite: pnpm test
- Building packages: pnpm build
- Running ESLint against examples to verify detection
- Packaging the VS Code extension: vsce package
- Publishing: npm publish / vsce publish
- Testing the MCP server manually

## Key commands
pnpm install                            # install all workspace deps
pnpm build                              # build all packages in order
pnpm test                               # run all tests
pnpm --filter @routeguard/core test     # single package
npx eslint examples/vulnerable-express  # test detection
cd packages/vscode-extension && vsce package  # build .vsix
routeguard setup                        # download Granite model (one-time, ~1.5GB)
routeguard doctor                       # verify model is present and loadable
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node packages/mcp-server/dist/index.js

## MCP + AI agent
The RouteGuard MCP server is available as a tool in Advanced mode.
Use it to analyze files during development:
- "Use RouteGuard to check @/packages/adapters/express/src/index.ts for vulnerabilities"
- "Analyze the vulnerable-express example and explain each finding"

## Safety
- Never run commands that modify examples/vulnerable-*
- Never git push without reviewing the diff first
- Never auto-approve destructive operations