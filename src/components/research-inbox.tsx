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

const filters: Array<{ id: InboxFilter; label: string }> = [
  { id: 'all', label: 'All research' },
  { id: 'candidates', label: 'Candidates' },
  { id: 'new', label: 'New' },
  { id: 'changed', label: 'Changed' },
  { id: 'violated', label: 'Thesis violations' },
];

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

  return <main>
    <section className="dashboard-hero animate-fade-in">
      <h1 className="text-glow">Research &amp; Analysis Inbox</h1>
      <p className="hero-lead">Read current company analyses. Review its financial statements, DCF and peers in the company dashboard; return to Discovery to record candidate decisions.</p>
      <div className="dashboard-hero-actions" aria-label="Research summary">
        <div className="stat-chip animate-scale-in delay-100"><span>Analyses</span><span className="stat-value">{currentRows.length}</span></div>
        <div className="stat-chip animate-scale-in delay-200"><span>Visible</span><span className="stat-value">{visible.length}</span></div>
        <div className="stat-chip animate-scale-in delay-300"><span>Thesis violations</span><span className="stat-value">{currentRows.filter((row) => (row.thesisBreakers?.length ?? 0) > 0).length}</span></div>
      </div>
    </section>
    <aside className="card workflow-next-action"><strong>Review before investing</strong><p>Open a company to assess its thesis fit, valuation and risks. Record actual holdings in Positions after your investment decision.</p><div className="workflow-actions"><Link className="text-link" href="/ai-stock-discovery#candidate-review">Review candidate decisions</Link><Link className="text-link" href="/positions">Open Positions</Link></div></aside>
    <div className="filter-bar" role="group" aria-label="Filter research">
      {filters.map((item) => <button key={item.id} type="button" className={`portfolio-tab${filter === item.id ? ' active' : ''}`} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}
    </div>
    <label className="research-inbox-search" htmlFor="research-inbox-query">Search company, ticker or summary
      <input id="research-inbox-query" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Company, ticker or research text" />
    </label>
    <label className="research-history-toggle"><input type="checkbox" checked={includeHistory} onChange={event => setIncludeHistory(event.target.checked)} /> Include superseded analysis versions</label>
    {loading ? <p className="note" role="status">Loading research…</p>
      : error ? <div className="login-error" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={() => void load()}>Retry loading research</button></div>
      : visible.length === 0 ? <div className="card"><p className="note">{query || filter !== 'all' ? 'No research matches these filters.' : 'No research analyses stored yet.'}</p><Link className="action-button inline-action" href="/ai-stock-discovery">Open Discovery</Link></div>
      : <div className="grid research-inbox-list">{visible.map((row) => {
        const kind = classify(row, byId);
        const badge = kind === 'violated' ? 'THESIS VIOLATION' : kind.toUpperCase();
        return <article className={`card glow-card feed-item ${kind}`} key={row.id}>
          <div className="section-heading"><div><p className="analysis-eyebrow">{row.portfolioCandidate ? 'Candidate' : row.portfolioRole}</p><h2>{row.companyName} <span className="cur">{row.ticker}</span></h2></div><span className={`badge ${kind === 'violated' ? 'breach' : kind === 'changed' ? 'watch' : 'ok'}`}>{badge}</span></div>
          <p className="note">Investment score {row.investmentScore}/100 · thesis alignment {row.thesisAlignmentScore}/100 · {new Date(row.analysisTimestamp).toLocaleString()}</p>
          {kind === 'violated' && <p className="caveat"><strong>Thesis breakers:</strong> {(row.thesisBreakers ?? []).join(' · ')}</p>}
          <p>{row.fundamentalSummary ?? 'No summary was stored for this analysis.'}</p>
          <div className="research-inbox-actions"><Link className="text-link" href={`/security/${encodeURIComponent(row.ticker)}`}>Open company dashboard</Link><Link className="text-link" href="/ai-stock-discovery#candidate-review">Review candidates and decisions in Discovery</Link></div>
        </article>;
      })}</div>}
  </main>;
}
