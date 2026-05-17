import { useState, useEffect } from 'react';
import { loadBenchmarkData } from '../data';
import type { BenchmarkData, BenchmarkRow } from '../types';

function pctColor(pct: string): string {
  const n = parseFloat(pct);
  if (isNaN(n)) return 'text-muted';
  if (n >= 90) return 'text-green';
  if (n >= 70) return 'text-amber';
  return 'text-red';
}

function Row({ row, isOverall }: { row: BenchmarkRow; isOverall?: boolean }) {
  return (
    <tr className={`border-b border-border ${isOverall ? 'border-t-2 border-t-border' : 'table-row-hover'}`}>
      <td className={`px-3 py-2 text-xs ${isOverall ? 'text-text font-bold' : 'text-amber'}`}>
        {row.rule}
      </td>
      <td className="px-3 py-2 text-xs text-green text-right">{row.tp}</td>
      <td className="px-3 py-2 text-xs text-red text-right">{row.fp}</td>
      <td className="px-3 py-2 text-xs text-amber text-right">{row.fn}</td>
      <td className={`px-3 py-2 text-xs text-right ${pctColor(row.precision)}`}>
        {row.precision}
      </td>
      <td className={`px-3 py-2 text-xs text-right ${pctColor(row.recall)}`}>
        {row.recall}
      </td>
      <td className={`px-3 py-2 text-xs text-right font-bold ${pctColor(row.f1)}`}>
        {row.f1}
      </td>
    </tr>
  );
}

export function Benchmark() {
  const [data, setData] = useState<BenchmarkData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBenchmarkData().then(d => {
      setData(d);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div className="text-muted text-xs">Loading benchmark report...</div>;
  }

  if (!data || data.rows.length === 0) {
    return (
      <div className="text-muted text-sm space-y-2">
        <p>No benchmark report found.</p>
        <p>
          Run:{' '}
          <span className="text-green">npx ts-node benchmark/runner.ts</span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted">
          Generated: <span className="text-text">{data.generated}</span>
          {' · '}
          Total findings: <span className="text-text">{data.totalFindings}</span>
        </div>
      </div>

      {data.overall && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card">
            <div className="text-muted text-xs mb-1">PRECISION</div>
            <div className={`stat-value ${pctColor(data.overall.precision)}`}>
              {data.overall.precision}
            </div>
          </div>
          <div className="card">
            <div className="text-muted text-xs mb-1">RECALL</div>
            <div className={`stat-value ${pctColor(data.overall.recall)}`}>
              {data.overall.recall}
            </div>
          </div>
          <div className="card">
            <div className="text-muted text-xs mb-1">F1 SCORE</div>
            <div className={`stat-value ${pctColor(data.overall.f1)}`}>
              {data.overall.f1}
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left text-xs text-muted tracking-widest">RULE</th>
              <th className="px-3 py-2 text-right text-xs text-muted tracking-widest">TP</th>
              <th className="px-3 py-2 text-right text-xs text-muted tracking-widest">FP</th>
              <th className="px-3 py-2 text-right text-xs text-muted tracking-widest">FN</th>
              <th className="px-3 py-2 text-right text-xs text-muted tracking-widest">PRECISION</th>
              <th className="px-3 py-2 text-right text-xs text-muted tracking-widest">RECALL</th>
              <th className="px-3 py-2 text-right text-xs text-muted tracking-widest">F1</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(row => (
              <Row key={row.rule} row={row} />
            ))}
            {data.overall && <Row row={data.overall} isOverall />}
          </tbody>
        </table>
      </div>
    </div>
  );
}
