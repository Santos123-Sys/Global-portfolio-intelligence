'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/analysis', { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { analyses?: AnalysisRow[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? `Research could not be loaded (${response.status})`);
        setRows(body.analyses ?? []);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError((cause as Error).message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      const kind = classify(row, byId);
      const filterMatches = filter === 'all' || (filter === 'candidates' ? row.portfolioCandidate : kind === filter);
      const queryMatches = !needle || `${row.companyName} ${row.ticker} ${row.portfolioRole} ${row.fundamentalSummary ?? ''}`.toLocaleLowerCase().includes(needle);
      return filterMatches && queryMatches;
    });
  }, [byId, filter, query, rows]);

  return <main>
    <h1>Research &amp; Analysis Inbox</h1>
    <p className="sub">Review analyzed candidates, new research, changed conclusions and thesis breakers. Candidate decisions remain in Discovery.</p>
    <div className="filter-bar" role="group" aria-label="Filter research">
      {filters.map((item) => <button key={item.id} type="button" className={`portfolio-tab${filter === item.id ? ' active' : ''}`} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}
    </div>
    <label className="research-inbox-search" htmlFor="research-inbox-query">Search company, ticker or summary
      <input id="research-inbox-query" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Company, ticker or research text" />
    </label>
    {loading ? <p className="note" role="status">Loading research…</p>
      : error ? <p className="login-error" role="alert">{error}</p>
      : visible.length === 0 ? <div className="card"><p className="note">{query || filter !== 'all' ? 'No research matches these filters.' : 'No research analyses stored yet.'}</p><Link className="action-button inline-action" href="/ai-stock-discovery">Open Discovery</Link></div>
      : <div className="grid research-inbox-list">{visible.map((row) => {
        const kind = classify(row, byId);
        const badge = kind === 'violated' ? 'THESIS VIOLATION' : kind.toUpperCase();
        return <article className={`card feed-item ${kind}`} key={row.id}>
          <div className="section-heading"><div><p className="analysis-eyebrow">{row.portfolioCandidate ? 'Candidate' : row.portfolioRole}</p><h2>{row.companyName} <span className="cur">{row.ticker}</span></h2></div><span className={`badge ${kind === 'violated' ? 'breach' : kind === 'changed' ? 'watch' : 'ok'}`}>{badge}</span></div>
          <p className="note">Investment score {row.investmentScore}/100 · thesis alignment {row.thesisAlignmentScore}/100 · {new Date(row.analysisTimestamp).toLocaleString()}</p>
          {kind === 'violated' && <p className="caveat"><strong>Thesis breakers:</strong> {(row.thesisBreakers ?? []).join(' · ')}</p>}
          <p>{row.fundamentalSummary ?? 'No summary was stored for this analysis.'}</p>
          <div className="research-inbox-actions"><Link className="text-link" href={`/security/${encodeURIComponent(row.ticker)}`}>Open security analysis</Link><Link className="text-link" href="/ai-stock-discovery#candidate-review">Review candidates and decisions in Discovery</Link></div>
        </article>;
      })}</div>}
  </main>;
}
