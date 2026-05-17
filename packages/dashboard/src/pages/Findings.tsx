import { useState, useMemo } from 'react';
import type { ParsedData, Finding } from '../types';

interface FindingsProps {
  data: ParsedData | null;
}

type SortKey = 'rule' | 'file' | 'line' | 'severity';

export function Findings({ data }: FindingsProps) {
  const [sortKey, setSortKey] = useState<SortKey>('file');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [filter, setFilter] = useState('');

  const findings = useMemo(() => {
    if (!data) return [];
    let items = data.findings;
    if (filter) {
      const q = filter.toLowerCase();
      items = items.filter(
        f =>
          f.shortRule.includes(q) ||
          f.file.toLowerCase().includes(q) ||
          f.message.toLowerCase().includes(q)
      );
    }
    return [...items].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      return String(av).localeCompare(String(bv)) * sortDir;
    });
  }, [data, sortKey, sortDir, filter]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  function colHeader(key: SortKey, label: string) {
    const active = sortKey === key;
    return (
      <th
        className="px-3 py-2 text-left text-xs text-muted tracking-widest cursor-pointer hover:text-text select-none"
        onClick={() => toggleSort(key)}
      >
        {label}
        {active && (
          <span className="ml-1 text-green">{sortDir === 1 ? '↑' : '↓'}</span>
        )}
      </th>
    );
  }

  if (!data) {
    return <div className="text-muted text-sm">No data. Run the benchmark first.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Filter by rule, file, or message..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="bg-surface border border-border text-text text-xs px-3 py-1.5 w-80 placeholder-muted"
        />
        <span className="text-muted text-xs">{findings.length} findings</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border">
              {colHeader('rule', 'RULE')}
              {colHeader('file', 'FILE')}
              {colHeader('line', 'LINE')}
              {colHeader('severity', 'SEV')}
              <th className="px-3 py-2 text-left text-xs text-muted tracking-widest">MESSAGE</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f, i) => (
              <FindingRow key={i} finding={f} />
            ))}
            {findings.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-muted text-center">
                  No findings match your filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FindingRow({ finding: f }: { finding: Finding }) {
  return (
    <tr className="border-b border-border table-row-hover">
      <td className="px-3 py-1.5 text-amber whitespace-nowrap">{f.shortRule}</td>
      <td className="px-3 py-1.5 text-text max-w-xs truncate" title={f.file}>
        {f.file}
      </td>
      <td className="px-3 py-1.5 text-muted whitespace-nowrap">
        {f.line}:{f.column}
      </td>
      <td className="px-3 py-1.5 whitespace-nowrap">
        <span className={f.severity === 'error' ? 'badge-red' : 'badge-amber'}>
          {f.severity}
        </span>
      </td>
      <td className="px-3 py-1.5 text-text max-w-md truncate" title={f.message}>
        {f.message}
      </td>
    </tr>
  );
}
