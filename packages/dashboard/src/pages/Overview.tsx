import type { ParsedData } from '../types';

interface OverviewProps {
  data: ParsedData | null;
}

const ALL_RULES = [
  'no-bola',
  'no-mass-assignment',
  'no-ssrf',
  'no-sql-injection',
  'no-command-injection',
  'no-path-traversal',
  'no-open-redirect',
  'no-hardcoded-secrets',
];

export function Overview({ data }: OverviewProps) {
  if (!data) {
    return (
      <div className="text-muted text-sm">
        No ESLint output found. Run the benchmark first:
        <br />
        <span className="text-green">npx eslint examples/ --format json &gt; benchmark/results/eslint-output.json</span>
      </div>
    );
  }

  const ruleMap = new Map(data.byRule.map(r => [r.shortRule, r.count]));
  const filesWithFindings = data.byFile.size;
  const coveredPct = data.totalFiles > 0
    ? Math.round((filesWithFindings / data.totalFiles) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card">
          <div className="text-muted text-xs mb-1">TOTAL FINDINGS</div>
          <div className="stat-value text-red">{data.totalFindings}</div>
        </div>
        <div className="card">
          <div className="text-muted text-xs mb-1">FILES SCANNED</div>
          <div className="stat-value text-text">{data.totalFiles}</div>
        </div>
        <div className="card">
          <div className="text-muted text-xs mb-1">FILES AFFECTED</div>
          <div className="stat-value text-amber">{filesWithFindings}</div>
        </div>
        <div className="card">
          <div className="text-muted text-xs mb-1">COVERAGE</div>
          <div className="stat-value text-green">{coveredPct}%</div>
        </div>
      </div>

      {/* By rule */}
      <div className="card">
        <div className="text-xs text-muted mb-3 tracking-widest">FINDINGS BY RULE</div>
        <div className="space-y-1">
          {ALL_RULES.map(rule => {
            const count = ruleMap.get(rule) ?? 0;
            const max = Math.max(...data.byRule.map(r => r.count), 1);
            const pct = Math.round((count / max) * 100);
            return (
              <div key={rule} className="flex items-center gap-3">
                <span className="text-xs text-text w-40 shrink-0">{rule}</span>
                <div className="flex-1 bg-border h-1.5">
                  <div
                    className="h-full bg-red"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className={`text-xs w-6 text-right ${count > 0 ? 'text-red' : 'text-muted'}`}>
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* By file */}
      <div className="card">
        <div className="text-xs text-muted mb-3 tracking-widest">TOP FILES</div>
        <div className="space-y-1">
          {Array.from(data.byFile.entries())
            .sort((a, b) => b[1].length - a[1].length)
            .slice(0, 10)
            .map(([file, findings]) => (
              <div key={file} className="flex items-center justify-between gap-2">
                <span className="text-xs text-text truncate">{file}</span>
                <span className="text-xs text-amber shrink-0">{findings.length}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
