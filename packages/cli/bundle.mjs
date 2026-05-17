import { build } from 'esbuild';
import { writeFileSync, readFileSync } from 'fs';

// Bundle the CLI entry
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: 'dist/index.js',
  external: ['eslint', 'node-llama-cpp', 'esbuild'],
  logLevel: 'warning',
});

// Add shebang so it works as a CLI binary
const content = readFileSync('dist/index.js', 'utf8');
if (!content.startsWith('#!/usr/bin/env node')) {
  writeFileSync('dist/index.js', '#!/usr/bin/env node\n' + content);
}

// Bundle the MCP server alongside the CLI so it works when installed from npm
await build({
  entryPoints: ['../mcp-server/src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: 'dist/mcp-server.js',
  external: ['eslint', 'node-llama-cpp', 'esbuild'],
  logLevel: 'warning',
});

console.log('CLI bundle written to dist/index.js');
console.log('MCP server bundle written to dist/mcp-server.js');
