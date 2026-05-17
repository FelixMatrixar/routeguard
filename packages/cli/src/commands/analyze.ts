import chalk from 'chalk';
import ora from 'ora';
import { resolve } from 'path';
import routeguardPlugin from '@felix-neuro/eslint-plugin-routeguard';

export async function runAnalyze(
  target: string,
  options: { ai?: boolean; rules?: string; projectRoot?: string }
): Promise<void> {
  const absTarget = resolve(options.projectRoot ?? process.cwd(), target);

  // ── Deterministic ESLint analysis ─────────────────────────────────────────
  const lintSpinner = ora(`Running deterministic analysis on ${chalk.cyan(target)}...`).start();

  try {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({
      useEslintrc: false,
      extensions: ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'],
      plugins: { '@felix-neuro/routeguard': (routeguardPlugin as any).default || routeguardPlugin },
      baseConfig: {
        plugins: ['@felix-neuro/routeguard'],
        parserOptions: {
          ecmaVersion: 2022,
          sourceType: 'module',
        },
        rules: {
          '@felix-neuro/routeguard/no-bola':              'error',
          '@felix-neuro/routeguard/no-mass-assignment':   'error',
          '@felix-neuro/routeguard/no-ssrf':              'error',
          '@felix-neuro/routeguard/no-sql-injection':     'error',
          '@felix-neuro/routeguard/no-command-injection': 'error',
          '@felix-neuro/routeguard/no-path-traversal':    'error',
          '@felix-neuro/routeguard/no-open-redirect':     'error',
          '@felix-neuro/routeguard/no-hardcoded-secrets': 'error',
        },
      },
    });

    const results = await eslint.lintFiles([absTarget]);
    lintSpinner.stop();

    let total = 0;
    for (const result of results) {
      const relevant = result.messages.filter(m => m.ruleId?.includes('routeguard'));
      if (relevant.length === 0) continue;
      console.log(chalk.underline(result.filePath));
      for (const m of relevant) {
        total++;
        const loc = chalk.dim(`${m.line}:${m.column}`);
        const rule = chalk.yellow(m.ruleId ?? '');
        console.log(`  ${loc}  ${chalk.red('error')}  ${m.message}  ${rule}`);
      }
      console.log('');
    }

    if (total === 0) {
      console.log(chalk.green('✓ No deterministic security findings.'));
    } else {
      console.log(chalk.red(`✖ ${total} problem${total !== 1 ? 's' : ''} found`));
    }
  } catch (err) {
    lintSpinner.fail(chalk.red(`Analysis failed: ${String(err)}`));
  }

  // ── AI analysis (optional) ─────────────────────────────────────────────────
  if (!options.ai) return;

  console.log('');
  const { isModelReady } = await import('../../../mcp-server/src/agent/granite');

  if (!isModelReady()) {
    console.log(
      chalk.yellow('⚠ AI analysis skipped') +
      chalk.dim(' — model not found. Run: routeguard setup')
    );
    return;
  }

  const aiSpinner = ora('Running AI analysis (this may take 1–4 minutes)...').start();
  try {
    const { analyzeRoute } = await import('../../../mcp-server/src/agent/loop');
    const { statSync, readdirSync } = await import('fs');
    const { join } = await import('path');
    
    const AI_RULES = ['API2', 'API5', 'API6', 'API8', 'API9', 'API10'] as const;

    aiSpinner.stop();
    let aiFindings = 0;

    const isDir = statSync(absTarget).isDirectory();
    let filesToAnalyze: string[] = [];

    if (isDir) {
      const walkSync = (dir: string, filelist: string[] = []) => {
        const files = readdirSync(dir);
        for (const file of files) {
          const filepath = join(dir, file);
          if (statSync(filepath).isDirectory()) {
            if (file !== 'node_modules') {
              filelist = walkSync(filepath, filelist);
            }
          } else {
            if (/\.(js|ts|jsx|tsx|mjs|cjs)$/.test(file)) {
              filelist.push(filepath);
            }
          }
        }
        return filelist;
      };
      filesToAnalyze = walkSync(absTarget);
    } else {
      filesToAnalyze = [absTarget];
    }

    if (filesToAnalyze.length === 0) {
      console.log(chalk.yellow(`⚠ No JS/TS files found for AI analysis in ${absTarget}`));
      return;
    }

    for (const file of filesToAnalyze) {
      if (filesToAnalyze.length > 1) {
        console.log(chalk.underline(`\nAnalyzing ${file} with AI:`));
      }
      for (const rule of AI_RULES) {
        const ruleSpinner = ora(`  ${rule}...`).start();
        const { finding } = await analyzeRoute(rule, file, '(file)', process.cwd());
        if (finding) {
          aiFindings++;
          ruleSpinner.warn(
            chalk.yellow(`[${finding.confidence.toUpperCase()}] ${rule}: ${finding.evidence}`)
          );
          console.log(chalk.dim(`    ${finding.suggestedReview}`));
        } else {
          ruleSpinner.succeed(chalk.dim(`${rule}: no issues found`));
        }
      }
    }

    console.log('');
    if (aiFindings === 0) {
      console.log(chalk.green('✓ No AI security findings.'));
    } else {
      console.log(chalk.yellow(`⚠ ${aiFindings} potential AI finding${aiFindings !== 1 ? 's' : ''} (always severity: warning)`));
    }
  } catch (err) {
    aiSpinner.fail(chalk.red(`AI analysis failed: ${String(err)}`));
  }
}
