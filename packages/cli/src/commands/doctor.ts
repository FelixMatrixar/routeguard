import chalk from 'chalk';
import { existsSync, statSync } from 'fs';
import { MODEL_PATH, fmtBytes } from '../utils/download-model';

const EXPECTED_MIN_SIZE = 1_400_000_000;
const COL = 20; // label column width

function row(label: string, icon: string, detail: string): void {
  console.log(icon + ' ' + label.padEnd(COL) + chalk.dim(detail));
}

function ok(label: string, detail: string)   { row(label, chalk.green('✓'), detail); }
function fail(label: string, detail: string) { row(label, chalk.red('✗'),   detail); }
function warn(label: string, detail: string) { row(label, chalk.yellow('⚠'), detail); }

export async function runDoctor(): Promise<void> {
  console.log(chalk.bold('\nRouteGuard Doctor\n'));
  let allGood = true;

  // 1 — node-llama-cpp
  try {
    const llama = await import('node-llama-cpp');
    const version = (llama as Record<string, unknown>)['version'] ?? 'installed';
    ok('node-llama-cpp', String(version));
  } catch {
    fail('node-llama-cpp', 'not found — run: npm install node-llama-cpp');
    allGood = false;
  }

  // 2 — model file exists + correct size
  if (!existsSync(MODEL_PATH)) {
    fail('Model file', 'not found — run: routeguard setup');
    allGood = false;
  } else {
    const size = statSync(MODEL_PATH).size;
    if (size < EXPECTED_MIN_SIZE) {
      warn('Model file', `incomplete — ${fmtBytes(size)} (expected ~1.47 GB) — run: routeguard setup`);
      allGood = false;
    } else {
      ok('Model file', `${MODEL_PATH} (${fmtBytes(size)})`);
    }
  }

  // 3 — model loadable (timeout 10s)
  if (existsSync(MODEL_PATH) && statSync(MODEL_PATH).size >= EXPECTED_MIN_SIZE) {
    try {
      const { getLlama } = await import('node-llama-cpp');
      const t0 = Date.now();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 10_000)
      );
      await Promise.race([
        (async () => {
          const llama = await getLlama();
          const model = await llama.loadModel({ modelPath: MODEL_PATH });
          await model.dispose();
        })(),
        timeoutPromise,
      ]);
      ok('Model loadable', `loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (err) {
      const msg = String(err).includes('timeout') ? 'timed out after 10s' : String(err);
      warn('Model loadable', msg);
    }
  } else {
    warn('Model loadable', 'skipped — model file not ready');
  }

  // 4 — ESLint plugin
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const plugin = require('@felix-neuro/eslint-plugin-routeguard') as { meta?: { version?: string } };
    const version = plugin?.meta?.version ?? 'installed';
    ok('ESLint plugin', `@felix-neuro/eslint-plugin-routeguard v${version}`);
  } catch {
    try {
      require('eslint-plugin-routeguard');
      ok('ESLint plugin', 'eslint-plugin-routeguard (legacy name)');
    } catch {
      fail('ESLint plugin', 'not found — run: npm install -g @felix-neuro/eslint-plugin-routeguard');
      allGood = false;
    }
  }

  // 5 — MCP server dist exists
  const { join: pathJoin } = require('path');
  const mcpCandidates: string[] = [
    pathJoin(__dirname, 'mcp-server.js'),
    pathJoin(__dirname, '../../mcp-server/dist/server.js'),
    pathJoin(__dirname, '../../../mcp-server/dist/server.js'),
  ];
  const mcpPath = mcpCandidates.find(existsSync);
  if (mcpPath) {
    ok('MCP server', mcpPath);
  } else {
    warn('MCP server', 'not found — run: routeguard mcp (will show setup instructions)');
  }

  console.log('');
  if (allGood) {
    console.log(chalk.green('All systems go.') + chalk.dim(" Run 'routeguard analyze <path>' to start."));
  } else {
    console.log(chalk.yellow('Some checks failed.') + chalk.dim(' Fix the issues above and run doctor again.'));
    process.exitCode = 1;
  }
}
