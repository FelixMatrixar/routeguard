import chalk from 'chalk';
import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

export async function runDashboard(options: { port?: number }): Promise<void> {
  const port = options.port ?? 4747;

  // Find dashboard package — works from global install or monorepo
  const candidates = [
    join(__dirname, '../../dashboard'),
    join(__dirname, '../../../dashboard'),
    resolve(process.cwd(), 'packages/dashboard'),
  ];

  const dashDir = candidates.find(d => existsSync(join(d, 'package.json')));
  if (!dashDir) {
    console.error(chalk.red('Dashboard package not found.'));
    console.error(chalk.dim('Expected at packages/dashboard — are you running from the routeguard repo?'));
    process.exit(1);
  }

  // Check if dist exists (production) or src (dev)
  const distIndex = join(dashDir, 'dist', 'index.html');
  if (existsSync(distIndex)) {
    // Serve pre-built dist with a simple static server
    try {
      execSync('npx --yes serve --version', { stdio: 'pipe' });
    } catch {
      // ignore — just try serve
    }
    console.log(chalk.green(`\nStarting dashboard on http://localhost:${port}\n`));
    console.log(chalk.dim('Press Ctrl+C to stop.\n'));
    const child = spawn('npx', ['serve', 'dist', '--listen', String(port)], {
      cwd: dashDir,
      stdio: 'inherit',
      shell: true,
    });
    child.on('exit', (code) => process.exit(code ?? 0));
  } else {
    // Dev mode — run vite
    console.log(chalk.green(`\nStarting dashboard dev server on http://localhost:${port}\n`));
    console.log(chalk.dim('Press Ctrl+C to stop.\n'));
    const child = spawn('npx', ['vite', '--port', String(port)], {
      cwd: dashDir,
      stdio: 'inherit',
      shell: true,
    });
    child.on('exit', (code) => process.exit(code ?? 0));
  }
}
