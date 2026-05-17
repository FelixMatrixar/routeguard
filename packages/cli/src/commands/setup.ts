import chalk from 'chalk';
import ora from 'ora';
import {
  downloadModel,
  isModelPresent,
  modelSize,
  MODEL_PATH,
  fmtBytes,
} from '../utils/download-model';

const EXPECTED_MIN_SIZE = 1_400_000_000; // 1.4 GB — reject clearly truncated files

export async function runSetup(): Promise<void> {
  console.log(chalk.bold('\nRouteGuard Setup\n'));

  // Step 1 — node-llama-cpp
  const llamaSpinner = ora('Checking node-llama-cpp...').start();
  try {
    await import('node-llama-cpp');
    llamaSpinner.succeed(chalk.green('node-llama-cpp ready'));
  } catch {
    llamaSpinner.fail(chalk.red('node-llama-cpp not found — run: npm install node-llama-cpp'));
    process.exit(1);
  }

  // Step 2 — model file
  if (isModelPresent() && modelSize() >= EXPECTED_MIN_SIZE) {
    console.log(chalk.green('✓') + ' Model already present — ' + chalk.dim(MODEL_PATH));
    console.log(chalk.dim('  ' + fmtBytes(modelSize()) + ' — skipping download'));
  } else {
    if (isModelPresent()) {
      console.log(chalk.yellow('⚠') + ' Incomplete model found — resuming download');
    }

    console.log(
      chalk.cyan('\nDownloading Granite 3.3 2B Instruct Q4_K_M...') +
      chalk.dim('\nSource: huggingface.co/ibm-granite/granite-3.3-2b-instruct-GGUF') +
      chalk.dim('\nSize:   ~1.47 GB\n')
    );

    const bar = ora({ text: 'Starting...', spinner: 'dots' }).start();
    let lastPct = 0;

    try {
      await downloadModel((received, total) => {
        const pct = Math.floor((received / total) * 100);
        if (pct === lastPct) return;
        lastPct = pct;
        const filled = Math.floor(pct / 5);
        const block = '█'.repeat(filled) + '░'.repeat(20 - filled);
        bar.text = `${block} ${pct}%  (${fmtBytes(received)} / ${fmtBytes(total)})`;
      });
      bar.succeed(chalk.green(`Model saved to ${MODEL_PATH}`));
    } catch (err) {
      bar.fail(chalk.red(`Download failed: ${String(err)}`));
      console.log(chalk.dim('Run \'routeguard setup\' again to resume from where it stopped.'));
      process.exit(1);
    }
  }

  // Step 3 — verify model loadable
  const verifySpinner = ora('Verifying model loads correctly...').start();
  try {
    const { getLlama } = await import('node-llama-cpp');
    const llama = await getLlama();
    const model = await llama.loadModel({ modelPath: MODEL_PATH });
    await model.dispose();
    verifySpinner.succeed(chalk.green('Model verified — loads successfully'));
  } catch (err) {
    verifySpinner.warn(
      chalk.yellow(`Could not verify model load: ${String(err)}`) +
      chalk.dim('\n  The file may still work — try \'routeguard doctor\' after setup.')
    );
  }

  // Done
  console.log(chalk.bold('\n✓ Setup complete\n'));
  console.log(
    '  ' + chalk.green('Deterministic rules (8)') + '  active via ESLint + MCP\n' +
    '  ' + chalk.cyan('AI rules (6)') + '             active via: ' +
    chalk.dim('routeguard analyze --ai <path>\n') +
    '                              MCP tool: ' + chalk.dim('ai_analyze_route') + '\n'
  );
  console.log(chalk.dim("Run 'routeguard doctor' at any time to verify your setup."));
}
