'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface AnalysisRow {
  id: string;
  ticker: string;
  companyName: string;
  portfolioCandidate: boolean;
  portfolioRole: string;
  investmentScore: number;
  thesisAlignmentScore: number;
  fundamentalSummary: string | null;
  thesisBreakers: string[] | null;
  supersedesId: string | null;
  analysisTimestamp: string;
}

type InboxFilter = 'all' | 'candidates' | 'new' | 'changed' | 'violated';

function classify(row: AnalysisRow, byId: Map<string, AnalysisRow>): Exclude<InboxFilter, 'all' | 'candidates'> {
  if (row.thesisBreakers?.length) return 'violated';
  if (row.supersedesId && byId.has(row.supersedesId)) return 'changed';
  return 'new';
}

const filters: Array<{ id: InboxFilter; label: string; description: string }> = [
  { id: 'all', label: 'Current research', description: 'Latest accepted report for each company.' },
  { id: 'candidates', label: 'Candidates', description: 'Companies still in the investment-decision funnel.' },
  { id: 'new', label: 'New', description: 'First accepted research version.' },
  { id: 'changed', label: 'Changed', description: 'Research that supersedes an earlier version.' },
  { id: 'violated', label: 'Thesis violations', description: 'Reports with explicit thesis breakers.' },
];

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString();
}

export function ResearchInbox() {
  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [query, setQuery] = useState('');
  const [includeHistory, setIncludeHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/analysis', { signal });
      const body = await response.json() as { analyses?: AnalysisRow[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? `Research could not be loaded (${response.status})`);
      if (!signal?.aborted) setRows(body.analyses ?? []);
    } catch (cause) {
      if (!signal?.aborted) setError((cause as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const supersededIds = useMemo(() => new Set(rows.flatMap(row => row.supersedesId ? [row.supersedesId] : [])), [rows]);
  const currentRows = useMemo(() => rows.filter(row => !supersededIds.has(row.id)), [rows, supersededIds]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (includeHistory ? rows : currentRows).filter((row) => {
      const kind = classify(row, byId);
      const filterMatches = filter === 'all' || (filter === 'candidates' ? row.portfolioCandidate : kind === filter);
      const queryMatches = !needle || `${row.companyName} ${row.ticker} ${row.portfolioRole} ${row.fundamentalSummary ?? ''}`.toLocaleLowerCase().includes(needle);
      return filterMatches && queryMatches;
    }).sort((a, b) => new Date(b.analysisTimestamp).getTime() - new Date(a.analysisTimestamp).getTime());
  }, [byId, currentRows, filter, includeHistory, query, rows]);

  const candidateCount = currentRows.filter(row => row.portfolioCandidate).length;
  const violationCount = currentRows.filter(row => (row.thesisBreakers?.length ?? 0) > 0).length;
  const changedCount = currentRows.filter(row => classify(row, byId) === 'changed').length;

  return <main className="research-workbench">
    <section className="dashboard-hero animate-fade-in">
      <p className="analysis-eyebrow">Intelligence workspace</p>
      <h1 className="text-glow">Research Workspace</h1>
      <p className="hero-lead">A governed view of accepted company research, thesis changes and evidence-backed investment conclusions. Start new work in Discovery; inspect active agent runs and provider health in Research Operations.</p>
      <div className="research-hero-actions">
        <Link className="action-button inline-action" href="/ai-stock-discovery">Discover companies</Link>
        <Link className="secondary-button inline-action" href="/research-operations">Research operations</Link>
      </div>
    </section>

    <section className="research-kpis" aria-label="Research portfolio summary">
      <div className="research-kpi"><span>Current reports</span><strong>{currentRows.length}</strong></div>
      <div className="research-kpi"><span>Candidate companies</span><strong>{candidateCount}</strong></div>
      <div className="research-kpi"><span>Changed theses</span><strong>{changedCount}</strong></div>
      <div className="research-kpi"><span>Thesis violations</span><strong>{violationCount}</strong></div>
    </section>

    <section className="research-workspace-grid">
      <aside className="research-control-rail card" aria-label="Research filters">
        <div><h2>Research view</h2><p className="note">Filter the current decision record without changing any investment state.</p></div>
        <div className="research-filter-stack" role="group" aria-label="Filter research">
          {filters.map((item) => <button key={item.id} type="button" className={`research-filter-button${filter === item.id ? ' active' : ''}`} aria-pressed={filter === item.id} title={item.description} onClick={() => setFilter(item.id)}>{item.label}</button>)}
        </div>
        <label className="research-inbox-search" htmlFor="research-inbox-query">Search research
          <input id="research-inbox-query" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Company, ticker or report text" />
        </label>
        <label className="research-history-toggle"><input type="checkbox" checked={includeHistory} onChange={event => setIncludeHistory(event.target.checked)} /> Include superseded report versions</label>
        <p className="note">Accepted research is a reviewed artifact, not an autonomous trade instruction. Portfolio changes remain human-controlled.</p>
      </aside>

      <div className="research-ledger">
        <div className="research-ledger-header"><div><h2>{filters.find(item => item.id === filter)?.label ?? 'Current research'}</h2><p className="note">{visible.length} report{visible.length === 1 ? '' : 's'} visible</p></div><Link className="text-link" href="/positions">Open portfolio</Link></div>
        {loading ? <div className="card"><p className="note" role="status">Loading research workspace…</p></div>
          : error ? <div className="card login-error" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={() => void load()}>Retry loading research</button></div>
          : visible.length === 0 ? <div className="card"><h2>No reports in this view</h2><p className="note">{query || filter !== 'all' ? 'Adjust the filters or search query.' : 'No accepted research analyses are stored yet.'}</p><Link className="action-button inline-action" href="/ai-stock-discovery">Start with Discovery</Link></div>
          : visible.map((row) => {
            const kind = classify(row, byId);
            const badge = kind === 'violated' ? 'THESIS VIOLATION' : kind.toUpperCase();
            return <article className={`research-report-card ${kind}`} key={row.id}>
              <div className="research-report-main">
                <div className="research-report-heading"><h3>{row.companyName} <span className="cur">{row.ticker}</span></h3><span className={`badge ${kind === 'violated' ? 'breach' : kind === 'changed' ? 'watch' : 'ok'}`}>{badge}</span>{row.portfolioCandidate && <span className="badge ok">CANDIDATE</span>}</div>
                <div className="research-report-meta"><span>{row.portfolioRole}</span><span>{formatDate(row.analysisTimestamp)}</span></div>
                {kind === 'violated' && <p className="caveat"><strong>Thesis breakers:</strong> {(row.thesisBreakers ?? []).join(' · ')}</p>}
                <p className="research-report-summary">{row.fundamentalSummary ?? 'No narrative summary was stored for this analysis.'}</p>
                <div className="research-report-actions"><Link className="text-link" href={`/security/${encodeURIComponent(row.ticker)}`}>Open company research</Link><Link className="text-link" href="/ai-stock-discovery#candidate-review">Review investment decision</Link></div>
              </div>
              <div className="research-score-panel" aria-label={`${row.ticker} research scores`}>
                <div className="research-score"><span>Investment</span><strong>{row.investmentScore}/100</strong></div>
                <div className="research-score"><span>Thesis fit</span><strong>{row.thesisAlignmentScore}/100</strong></div>
              </div>
            </article>;
          })}
      </div>
    </section>
  </main>;
}
