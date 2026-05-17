interface NavProps {
  current: string;
}

const PAGES = [
  { id: 'overview', label: 'Overview' },
  { id: 'findings', label: 'Findings' },
  { id: 'routes', label: 'Route Map' },
  { id: 'rules', label: 'Rules' },
  { id: 'benchmark', label: 'Benchmark' },
];

export function Nav({ current }: NavProps) {
  return (
    <nav className="flex items-center gap-0 border-b border-border mb-6">
      <span className="text-green font-bold mr-6 text-sm tracking-widest select-none">
        ROUTEGUARD
      </span>
      {PAGES.map(p => (
        <a
          key={p.id}
          href={`#${p.id}`}
          className={[
            'px-4 py-2 text-xs tracking-wider border-b-2 transition-colors',
            current === p.id
              ? 'border-green text-green'
              : 'border-transparent text-muted hover:text-text',
          ].join(' ')}
        >
          {p.label}
        </a>
      ))}
    </nav>
  );
}
