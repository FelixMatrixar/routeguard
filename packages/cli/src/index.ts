#!/usr/bin/env node
import { Command } from 'commander';
import { runSetup } from './commands/setup';
import { runDoctor } from './commands/doctor';
import { runAnalyze } from './commands/analyze';
import { runDashboard } from './commands/dashboard';
import { runMCP } from './commands/mcp';

const program = new Command();

program
  .name('routeguard')
  .description('OWASP API security analysis for Node.js backends')
  .version('1.0.5');

program
  .command('setup')
  .description('Download the Granite 3.3 2B model for AI-powered analysis (one-time, ~1.5 GB)')
  .action(() => runSetup().catch(die));

program
  .command('doctor')
  .description('Verify that all RouteGuard components are installed and working')
  .action(() => runDoctor().catch(die));

program
  .command('analyze <path>')
  .description('Run security analysis on a file or directory')
  .option('--ai', 'Also run AI agent analysis (requires model — run setup first)')
  .option('--rules <rules>', 'Comma-separated AI rules to run (API2,API5,API6,API8,API9,API10)')
  .option('--project-root <dir>', 'Project root for resolving imports', process.cwd())
  .action((target: string, opts: { ai?: boolean; rules?: string; projectRoot?: string }) =>
    runAnalyze(target, opts).catch(die)
  );

program
  .command('dashboard')
  .description('Launch the security findings dashboard in your browser')
  .option('--port <number>', 'Port to listen on', '4747')
  .action((opts: { port?: string }) =>
    runDashboard({ port: opts.port ? parseInt(opts.port, 10) : undefined }).catch(die)
  );

program
  .command('mcp')
  .description('Start the MCP server (for use with Claude Desktop / Cursor / VS Code)')
  .action(() => runMCP());

program.parse();

function die(err: unknown): never {
  console.error((err instanceof Error ? err.message : String(err)));
  process.exit(1);
}
