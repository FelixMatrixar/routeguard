import type { ESLintFile, Finding, ParsedData, BenchmarkData, BenchmarkRow } from './types';

const RULE_PREFIX = 'routeguard/';

function shortRule(rule: string): string {
  return rule.startsWith(RULE_PREFIX) ? rule.slice(RULE_PREFIX.length) : rule;
}

function normalizeFilePath(fp: string): string {
  // Strip everything up to and including the workspace root marker
  const marker = 'examples/';
  const idx = fp.replace(/\\/g, '/').indexOf(marker);
  return idx >= 0 ? fp.slice(idx) : fp;
}

export async function loadESLintData(): Promise<ParsedData | null> {
  try {
    const res = await fetch('/eslint-output.json');
    if (!res.ok) return null;
    const files: ESLintFile[] = await res.json();

    const findings: Finding[] = [];
    for (const file of files) {
      const relPath = normalizeFilePath(file.filePath);
      for (const msg of file.messages) {
        if (!msg.ruleId) continue;
        findings.push({
          rule: msg.ruleId,
          shortRule: shortRule(msg.ruleId),
          file: relPath,
          line: msg.line,
          column: msg.column,
          message: msg.message,
          severity: msg.severity === 2 ? 'error' : 'warning',
        });
      }
    }

    const ruleMap = new Map<string, number>();
    for (const f of findings) {
      ruleMap.set(f.rule, (ruleMap.get(f.rule) ?? 0) + 1);
    }
    const byRule = Array.from(ruleMap.entries())
      .map(([rule, count]) => ({ rule, shortRule: shortRule(rule), count }))
      .sort((a, b) => b.count - a.count);

    const byFile = new Map<string, Finding[]>();
    for (const f of findings) {
      const list = byFile.get(f.file) ?? [];
      list.push(f);
      byFile.set(f.file, list);
    }

    return {
      findings,
      byRule,
      byFile,
      totalFiles: files.length,
      totalFindings: findings.length,
      errorCount: findings.filter(f => f.severity === 'error').length,
      warningCount: findings.filter(f => f.severity === 'warning').length,
    };
  } catch {
    return null;
  }
}

export async function loadBenchmarkData(): Promise<BenchmarkData | null> {
  try {
    const res = await fetch('/report.md');
    if (!res.ok) return null;
    const text = await res.text();
    return parseBenchmarkReport(text);
  } catch {
    return null;
  }
}

function parseBenchmarkReport(text: string): BenchmarkData {
  const lines = text.split('\n');
  let generated = '';
  let totalFindings = 0;
  const rows: BenchmarkRow[] = [];
  let overall: BenchmarkRow | null = null;

  for (const line of lines) {
    if (line.startsWith('Generated:')) {
      generated = line.replace('Generated:', '').trim();
    } else if (line.startsWith('Total findings:')) {
      totalFindings = parseInt(line.replace('Total findings:', '').trim(), 10) || 0;
    } else if (line.startsWith('| ') && !line.startsWith('| Rule') && !line.startsWith('|---')) {
      const cols = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length >= 7) {
        const rule = cols[0].replace(/\*\*/g, '');
        const row: BenchmarkRow = {
          rule,
          tp: parseInt(cols[1].replace(/\*\*/g, ''), 10) || 0,
          fp: parseInt(cols[2].replace(/\*\*/g, ''), 10) || 0,
          fn: parseInt(cols[3].replace(/\*\*/g, ''), 10) || 0,
          precision: cols[4].replace(/\*\*/g, ''),
          recall: cols[5].replace(/\*\*/g, ''),
          f1: cols[6].replace(/\*\*/g, ''),
        };
        if (rule === 'overall') {
          overall = row;
        } else {
          rows.push(row);
        }
      }
    }
  }

  return { generated, totalFindings, rows, overall };
}
