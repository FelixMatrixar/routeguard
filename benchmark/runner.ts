#!/usr/bin/env node
/**
 * RouteGuard Benchmark Runner
 *
 * Usage:
 *   npx ts-node benchmark/runner.ts
 *   # or after build:
 *   node benchmark/runner.js
 *
 * What it does:
 *   1. Runs `npx eslint` with --format json on examples/
 *   2. Loads benchmark/ground-truth.json
 *   3. Matches actual findings to expected entries (±1 line tolerance)
 *   4. Calculates precision, recall, F1 per rule
 *   5. Writes benchmark/results/report.md
 */

import { execSync } from 'child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT   = resolve(__dirname, '..');
const RESULT_DIR = join(__dirname, 'results');

// ─── Types ────────────────────────────────────────────────────────────────────

interface GroundTruthEntry {
  id: string;
  rule: string;
  file: string;
  line: number;
  mustNotFire?: boolean;
  framework: string;
  orm: string;
  description: string;
}

interface ESLintMessage {
  ruleId: string | null;
  severity: number;
  message: string;
  line: number;
  column: number;
}

interface ESLintFile {
  filePath: string;
  messages: ESLintMessage[];
  errorCount: number;
  warningCount: number;
}

interface RuleStats {
  tp: number; // true positives  (expected fires, did fire)
  fp: number; // false positives (not expected to fire, did fire)
  fn: number; // false negatives (expected to fire, didn't)
  precision: number;
  recall: number;
  f1: number;
}

// ─── Run ESLint ───────────────────────────────────────────────────────────────

function runESLint(): ESLintFile[] {
  console.log('Running ESLint on examples/...');

  // Resolve the plugin from the workspace
  const cmd = [
    'npx eslint',
    'examples/vulnerable-express',
    'examples/vulnerable-fastify',
    'examples/secure-mixed',
    '--format json',
    '--rule "routeguard/no-bola: error"',
    '--rule "routeguard/no-mass-assignment: error"',
    '--rule "routeguard/no-ssrf: error"',
    '--rule "routeguard/no-sql-injection: error"',
    '--rule "routeguard/no-command-injection: error"',
    '--rule "routeguard/no-path-traversal: error"',
    '--rule "routeguard/no-open-redirect: error"',
    '--rule "routeguard/no-hardcoded-secrets: error"',
  ].join(' ');

  let output: string;
  try {
    output = execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      // ESLint exits 1 when there are lint errors — that's expected
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    // eslint exits 1 on findings — capture stdout from the error
    const e = err as { stdout?: string; stderr?: string };
    output = e.stdout ?? '[]';
    if (e.stderr) {
      console.error('ESLint stderr:', e.stderr.slice(0, 500));
    }
  }

  try {
    return JSON.parse(output) as ESLintFile[];
  } catch {
    console.error('Failed to parse ESLint output. Raw:', output.slice(0, 300));
    return [];
  }
}

// ─── Match findings ───────────────────────────────────────────────────────────

function normaliseFilePath(fp: string): string {
  // Convert absolute path to root-relative forward-slash path
  return fp.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '');
}

interface ActualFinding {
  rule: string;
  file: string;
  line: number;
}

function collectActualFindings(eslintOutput: ESLintFile[]): ActualFinding[] {
  const findings: ActualFinding[] = [];
  for (const file of eslintOutput) {
    const relPath = normaliseFilePath(file.filePath);
    for (const msg of file.messages) {
      if (!msg.ruleId) continue;
      findings.push({ rule: msg.ruleId, file: relPath, line: msg.line });
    }
  }
  return findings;
}

function matchesFinding(actual: ActualFinding, expected: GroundTruthEntry): boolean {
  return (
    actual.rule === expected.rule &&
    actual.file === expected.file.replace(/\\/g, '/') &&
    Math.abs(actual.line - expected.line) <= 1
  );
}

// ─── Calculate stats ──────────────────────────────────────────────────────────

function calculateStats(
  groundTruth: GroundTruthEntry[],
  actualFindings: ActualFinding[]
): Map<string, RuleStats> {
  const allRules = new Set([
    'routeguard/no-bola',
    'routeguard/no-mass-assignment',
    'routeguard/no-ssrf',
    'routeguard/no-sql-injection',
    'routeguard/no-command-injection',
    'routeguard/no-path-traversal',
    'routeguard/no-open-redirect',
    'routeguard/no-hardcoded-secrets',
  ]);

  const stats = new Map<string, { tp: number; fp: number; fn: number }>();
  for (const rule of allRules) stats.set(rule, { tp: 0, fp: 0, fn: 0 });

  // mustFire entries: count TP and FN
  const mustFireEntries = groundTruth.filter(e => !e.mustNotFire);
  const matched = new Set<string>();

  for (const entry of mustFireEntries) {
    const hit = actualFindings.find(a => matchesFinding(a, entry));
    const s = stats.get(entry.rule) ?? { tp: 0, fp: 0, fn: 0 };
    if (hit) {
      s.tp++;
      matched.add(`${hit.rule}|${hit.file}|${hit.line}`);
    } else {
      s.fn++;
      console.warn(`  MISS: ${entry.id} — ${entry.description}`);
    }
    stats.set(entry.rule, s);
  }

  // mustNotFire entries: count FP if they fired
  const mustNotFireEntries = groundTruth.filter(e => e.mustNotFire);
  for (const entry of mustNotFireEntries) {
    const hit = actualFindings.find(a => matchesFinding(a, entry));
    if (hit) {
      const s = stats.get(entry.rule) ?? { tp: 0, fp: 0, fn: 0 };
      s.fp++;
      stats.set(entry.rule, s);
      console.warn(`  FALSE POSITIVE: ${entry.id} — ${entry.description}`);
    }
  }

  // Any actual finding not matched to a mustFire entry is a FP
  for (const actual of actualFindings) {
    const key = `${actual.rule}|${actual.file}|${actual.line}`;
    if (!matched.has(key)) {
      // Check it's not a mustNotFire we already counted
      const isMustNotFire = mustNotFireEntries.some(e => matchesFinding(actual, e));
      if (!isMustNotFire) {
        const s = stats.get(actual.rule);
        if (s) {
          s.fp++;
          stats.set(actual.rule, s);
        }
      }
    }
  }

  // Compute precision / recall / F1
  const result = new Map<string, RuleStats>();
  for (const [rule, s] of stats) {
    const precision = s.tp + s.fp > 0 ? s.tp / (s.tp + s.fp) : 1;
    const recall    = s.tp + s.fn > 0 ? s.tp / (s.tp + s.fn) : 1;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    result.set(rule, { ...s, precision, recall, f1 });
  }

  return result;
}

// ─── Report ───────────────────────────────────────────────────────────────────

function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function writeReport(stats: Map<string, RuleStats>, actualFindings: ActualFinding[]): void {
  const now = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `# RouteGuard Benchmark Report`,
    ``,
    `Generated: ${now}`,
    `Total findings: ${actualFindings.length}`,
    ``,
    `## Per-rule metrics`,
    ``,
    `| Rule | TP | FP | FN | Precision | Recall | F1 |`,
    `|---|---|---|---|---|---|---|`,
  ];

  for (const [rule, s] of stats) {
    const shortRule = rule.replace('routeguard/', '');
    lines.push(
      `| ${shortRule} | ${s.tp} | ${s.fp} | ${s.fn} | ${formatPct(s.precision)} | ${formatPct(s.recall)} | ${formatPct(s.f1)} |`
    );
  }

  // Overall
  let totalTP = 0, totalFP = 0, totalFN = 0;
  for (const s of stats.values()) { totalTP += s.tp; totalFP += s.fp; totalFN += s.fn; }
  const overallPrec = totalTP + totalFP > 0 ? totalTP / (totalTP + totalFP) : 1;
  const overallRec  = totalTP + totalFN > 0 ? totalTP / (totalTP + totalFN) : 1;
  const overallF1   = overallPrec + overallRec > 0
    ? (2 * overallPrec * overallRec) / (overallPrec + overallRec) : 0;

  lines.push(`| **overall** | **${totalTP}** | **${totalFP}** | **${totalFN}** | **${formatPct(overallPrec)}** | **${formatPct(overallRec)}** | **${formatPct(overallF1)}** |`);

  lines.push('', '## All findings', '');
  for (const f of actualFindings) {
    lines.push(`- \`${f.rule}\`  ${f.file}:${f.line}`);
  }

  const report = lines.join('\n');
  mkdirSync(RESULT_DIR, { recursive: true });
  writeFileSync(join(RESULT_DIR, 'report.md'), report, 'utf8');
  console.log(`\nReport written to benchmark/results/report.md`);
  console.log(`Overall — Precision: ${formatPct(overallPrec)}  Recall: ${formatPct(overallRec)}  F1: ${formatPct(overallF1)}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const groundTruthPath = join(__dirname, 'ground-truth.json');
  const { entries: groundTruth } = JSON.parse(
    readFileSync(groundTruthPath, 'utf8')
  ) as { entries: GroundTruthEntry[] };

  const eslintOutput = runESLint();
  const actualFindings = collectActualFindings(eslintOutput);

  console.log(`\nActual findings: ${actualFindings.length}`);
  for (const f of actualFindings) {
    console.log(`  [${f.rule}]  ${f.file}:${f.line}`);
  }

  const stats = calculateStats(groundTruth, actualFindings);
  writeReport(stats, actualFindings);
}

main();
