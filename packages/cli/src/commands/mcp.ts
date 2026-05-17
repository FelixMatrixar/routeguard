import chalk from 'chalk';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

export function runMCP(): void {
  // Find mcp-server dist — co-bundled first, then monorepo fallbacks
  const candidates = [
    join(__dirname, 'mcp-server.js'),
    join(__dirname, '../../mcp-server/dist/server.js'),
    join(__dirname, '../../../mcp-server/dist/server.js'),
    resolve(process.cwd(), 'packages/mcp-server/dist/server.js'),
  ];

  const serverJs = candidates.find(existsSync);
  if (!serverJs) {
    console.error(chalk.red('MCP server not built.'));
    console.error(chalk.dim('Run: pnpm --filter @routeguard/mcp-server build'));
    process.exit(1);
  }

  console.error(chalk.dim(`[routeguard-mcp] Starting MCP server: ${serverJs}`));
  console.error(chalk.dim('[routeguard-mcp] Add to Claude Desktop config:'));
  console.error(chalk.dim(JSON.stringify({
    mcpServers: {
      routeguard: { command: 'node', args: [serverJs] },
    },
  }, null, 2)));
  console.error('');

  // Exec in-process: replace current process with node dist/server.js
  const child = spawn(process.execPath, [serverJs], {
    stdio: 'inherit',
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}
