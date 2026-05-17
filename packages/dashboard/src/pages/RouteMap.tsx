import type { ParsedData, Finding } from '../types';

interface RouteMapProps {
  data: ParsedData | null;
}

function severityIcon(findings: Finding[]): string {
  if (findings.length === 0) return '✓';
  const hasError = findings.some(f => f.severity === 'error');
  return hasError ? '✗' : '⚠';
}

function severityColor(findings: Finding[]): string {
  if (findings.length === 0) return 'text-green';
  const hasError = findings.some(f => f.severity === 'error');
  return hasError ? 'text-red' : 'text-amber';
}

export function RouteMap({ data }: RouteMapProps) {
  if (!data) {
    return <div className="text-muted text-sm">No data. Run the benchmark first.</div>;
  }

  const entries = Array.from(data.byFile.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  // Also collect clean files (no findings)
  const allFiles = new Set<string>();
  for (const f of data.findings) allFiles.add(f.file);

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted">
        {data.totalFiles} files scanned &mdash; {data.byFile.size} with findings
      </div>

      {entries.map(([file, findings]) => (
        <div key={file} className="card">
          <div className="flex items-center gap-2 mb-2">
            <span className={`font-bold ${severityColor(findings)}`}>
              {severityIcon(findings)}
            </span>
            <span className="text-text text-xs font-bold">{file}</span>
            <span className="text-muted text-xs ml-auto">{findings.length} finding{findings.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="space-y-0.5 pl-4">
            {findings
              .sort((a, b) => a.line - b.line)
              .map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-muted w-8 shrink-0 text-right">{f.line}</span>
                  <span className="text-amber shrink-0">{f.shortRule}</span>
                  <span className="text-text truncate" title={f.message}>
                    {f.message}
                  </span>
                </div>
              ))}
          </div>
        </div>
      ))}

      {entries.length === 0 && (
        <div className="card text-green text-sm">
          ✓ No findings detected across all scanned files.
        </div>
      )}
    </div>
  );
}
