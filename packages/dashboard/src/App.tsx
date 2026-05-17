import { useState, useEffect } from 'react';
import { Nav } from './components/Nav';
import { Overview } from './pages/Overview';
import { Findings } from './pages/Findings';
import { RouteMap } from './pages/RouteMap';
import { Rules } from './pages/Rules';
import { Benchmark } from './pages/Benchmark';
import { loadESLintData } from './data';
import type { ParsedData } from './types';

type Page = 'overview' | 'findings' | 'routes' | 'rules' | 'benchmark';

function getPage(): Page {
  const hash = window.location.hash.replace('#', '') as Page;
  const valid: Page[] = ['overview', 'findings', 'routes', 'rules', 'benchmark'];
  return valid.includes(hash) ? hash : 'overview';
}

export function App() {
  const [page, setPage] = useState<Page>(getPage);
  const [data, setData] = useState<ParsedData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    function onHashChange() {
      setPage(getPage());
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    loadESLintData().then(d => {
      setData(d);
      setLoading(false);
    });
  }, []);

  return (
    <div className="min-h-screen bg-bg p-4 md:p-6">
      <Nav current={page} />

      {loading ? (
        <div className="text-muted text-xs animate-pulse">Loading...</div>
      ) : (
        <>
          {page === 'overview' && <Overview data={data} />}
          {page === 'findings' && <Findings data={data} />}
          {page === 'routes' && <RouteMap data={data} />}
          {page === 'rules' && <Rules data={data} />}
          {page === 'benchmark' && <Benchmark />}
        </>
      )}
    </div>
  );
}
