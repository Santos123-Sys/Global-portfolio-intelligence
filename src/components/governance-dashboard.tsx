'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PortfolioWorkspaceNav } from '@/components/portfolio-workspace-nav';

type Severity = 'info' | 'watch' | 'breach';
interface GovernanceData {
  generatedAt: string;
  construction: Array<{ portfolioName: string; currency: string; mandateStatus: 'active' | 'holdings_only'; holdingCount: number; weightsAvailable: boolean; weightSource: string | null; weightReason: string | null; issues: Array<{ severity: Severity; label: string; detail: string }>; sectors: Array<{ name: string; weight: number }>; countries: Array<{ name: string; weight: number }>; holdings: Array<{ ticker: string; companyName: string; weight: number | null }>; attribution: Array<{ ticker: string; contribution: number; dataAsOf: string | null }>; riskAsOf: string | null }>;
  freshness: Array<{ portfolioName: string; ticker: string; companyName: string; priceAgeDays: number | null; analysisAgeDays: number | null; evidenceAgeDays: number | null; priceStatus: string; evidenceStatus: string; analysisStatus: string; lastPriceDate: string | null; latestProvider: string | null }>;
  reviewQueue: Array<{ severity: Severity; title: string; detail: string; portfolioName: string | null; ticker: string | null; category: string }>;
  providerHealth: Array<{ provider: string; endpoint: string; ok: number; errors: number; planLimits: number; rateLimited: number; lastCalledAt: string }>;
  committeeMemos: Array<{ candidateId: string; companyName: string; ticker: string; portfolioName: string; decision: string; thesisVersion: number | null; investmentThesis: string | null; catalysts: string[]; risks: string[]; gaps: string[]; evidenceAsOf: string | null; valuation: { currency: string; fairValuePerShare: number; terminalShare: number | null; caveats: string[] } | null; journal: Record<string, string> | null; decisionDate: string | null }>;
  valuationCoverage: { total: number; dcf: number; comparables: number; latest: Array<{ candidate: string; method: string; createdAt: string; status: string }> };
  versioning: { thesisVersions: Array<{ version: number; effectiveDate: string; supersededAt: string | null; excludedAt: string | null }>; decisions: Array<{ title: string; decision: string; date: string; metadata: { thesisVersionId?: string; valuationScenarioId?: string; evidenceAsOf?: string } | null }> };
  monitoringCoverage: Array<{ capability: string; status: string; detail: string }>;
}

function percent(value: number | null | undefined) { return value == null ? '—' : `${(value * 100).toFixed(1)}%`; }
function age(value: number | null) { return value == null ? 'not available' : `${value} day${value === 1 ? '' : 's'}`; }

export function GovernanceDashboard() {
  const [data, setData] = useState<GovernanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch('/api/governance');
      const body = await response.json().catch(() => ({})) as GovernanceData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Governance data failed (${response.status})`);
      setData(body); setError(null);
    } catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    void load();
    fetch('/api/auth/session').then((response) => response.ok ? response.json() : null)
      .then((session) => setIsPlatformAdmin(Boolean(session?.account?.isPlatformAdmin)))
      .catch(() => undefined);
  }, []);
  const queue = useMemo(() => data?.reviewQueue ?? [], [data]);

  if (loading && !data) return <main><PortfolioWorkspaceNav /><h1>Investment control center</h1><p className="note">Loading governance evidence…</p></main>;
  if (!data) return <main><PortfolioWorkspaceNav /><h1>Investment control center</h1><p className="login-error">{error ?? 'Governance data is unavailable.'}</p></main>;

  return <main>
    <PortfolioWorkspaceNav />
    <h1>Investment control center</h1>
    <p className="sub">Construction, evidence freshness, valuation discipline, portfolio attribution, and review priorities. These are decision guardrails—not automated trading instructions.</p>
    {error && <p className="login-error" role="alert">{error}</p>}

    <section className="governance-kpis" aria-label="Control summary">
      <article className="card"><span>Review queue</span><strong>{queue.length}</strong><p>{queue.filter((item) => item.severity === 'breach').length} breaches · {queue.filter((item) => item.severity === 'watch').length} watch items</p></article>
      <article className="card"><span>Valuation scenarios</span><strong>{data.valuationCoverage.total}</strong><p>{data.valuationCoverage.dcf} DCF · {data.valuationCoverage.comparables} comparables</p></article>
      <article className="card"><span>Freshness coverage</span><strong>{data.freshness.filter((item) => item.priceStatus === 'current').length}/{data.freshness.length}</strong><p>holdings with current price evidence</p></article>
      <article className="card"><span>Thesis versions</span><strong>{data.versioning.thesisVersions.length}</strong><p>Immutable decisions retain the context available when made.</p></article>
    </section>

    <section className="card governance-section">
      <div className="section-heading"><div><h2>Priority review queue</h2><p className="note">Generated from stored data, alerts, approved thesis breakers, and the optional guardrails attached to the Thesis workflow.</p></div><button className="secondary-button" type="button" onClick={() => void load()}>Refresh</button></div>
      {queue.length === 0 ? <p className="note">No current review prompts. This does not prove the portfolio is risk-free; it means no configured, evidence-based trigger is currently open.</p> : <div className="governance-queue">{queue.map((item, index) => <article key={`${item.category}:${item.title}:${index}`} className={`governance-queue-item ${item.severity}`}><span className={`badge ${item.severity === 'info' ? 'ok' : item.severity}`}>{item.category}</span><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.portfolioName ?? 'All portfolios'}{item.ticker ? ` · ${item.ticker}` : ''}</small></div></article>)}</div>}
    </section>

    <section className="card governance-section">
      <h2>Portfolio construction and attribution</h2>
      <p className="note">Weights are evaluated only within each portfolio; native-currency portfolios are never summed into a misleading combined total.</p>
      {data.construction.length === 0 ? <p className="note">No active thesis portfolio or invested legacy portfolio is available.</p> : <div className="governance-portfolio-grid">{data.construction.map((portfolio) => <article className="governance-portfolio" key={portfolio.portfolioName}>
        <h3>{portfolio.portfolioName} <span className="cur">{portfolio.currency}</span></h3>
        {portfolio.mandateStatus === 'holdings_only' && <p className="caveat">The originating mandate is no longer active. This portfolio remains visible only because it contains holdings.</p>}
        <p className="note">{portfolio.holdingCount} holdings · {portfolio.weightSource ? `exposure from ${portfolio.weightSource}` : 'exposure unavailable'}</p>
        {portfolio.issues.length ? <ul className="caveat">{portfolio.issues.map((issue) => <li key={issue.label}><strong>{issue.label}:</strong> {issue.detail}</li>)}</ul> : portfolio.holdingCount === 0 ? <p className="note">Add holdings to assess construction against the guardrails.</p> : portfolio.weightsAvailable ? <p className="security-state">No baseline construction breach detected.</p> : <p className="note">{portfolio.weightReason}</p>}
        <div className="governance-exposures"><div><strong>Largest positions</strong>{portfolio.holdings.slice(0, 5).map((holding) => <p key={holding.ticker}>{holding.ticker} <span>{percent(holding.weight)}</span></p>)}</div><div><strong>Sector exposure</strong>{portfolio.sectors.slice(0, 4).map((item) => <p key={item.name}>{item.name} <span>{percent(item.weight)}</span></p>)}</div><div><strong>Country exposure</strong>{portfolio.countries.slice(0, 4).map((item) => <p key={item.name}>{item.name} <span>{percent(item.weight)}</span></p>)}</div></div>
        <div className="governance-attribution"><strong>Return contribution</strong>{portfolio.attribution.length ? portfolio.attribution.slice(0, 5).map((item) => <p key={item.ticker}>{item.ticker} <span>{percent(item.contribution)}</span></p>) : <p className="note">Not yet available—run the scheduled price refresh after at least two observations.</p>}</div>
      </article>)}</div>}
    </section>

    <section className="card governance-section">
      <h2>Evidence freshness</h2>
      {data.freshness.length === 0 ? <p className="note">No holdings to monitor yet. Add a holding to start price and research freshness checks.</p> : <div className="table-scroll"><table><thead><tr><th>Holding</th><th>Portfolio</th><th>Price</th><th>Research</th><th>Other evidence</th><th>Source</th></tr></thead><tbody>{data.freshness.map((item) => <tr key={`${item.portfolioName}:${item.ticker}`}><td><strong>{item.companyName}</strong><br /><span className="note">{item.ticker}</span></td><td>{item.portfolioName}</td><td>{item.priceStatus} · {age(item.priceAgeDays)}</td><td>{item.analysisStatus} · {age(item.analysisAgeDays)}</td><td>{item.evidenceStatus} · {age(item.evidenceAgeDays)}</td><td>{item.latestProvider ?? '—'}</td></tr>)}</tbody></table></div>}
    </section>

    <section className="card governance-section">
      <h2>Investment committee memos</h2>
      <p className="note">Decision-ready summaries replace operational IDs with thesis, valuation, risks, source gaps, and the original human decision context.</p>
      {data.committeeMemos.length === 0 ? <p className="note">No approved or watchlist research candidate is available yet.</p> : <div className="committee-grid">{data.committeeMemos.map((memo) => <article className="committee-memo" key={memo.candidateId}><div className="section-heading"><div><h3>{memo.companyName} <span className="note">{memo.ticker}</span></h3><p>{memo.portfolioName} · Thesis v{memo.thesisVersion ?? 'not linked'} · {memo.decision}</p></div><span className="badge">{memo.evidenceAsOf ? `Evidence ${new Date(memo.evidenceAsOf).toLocaleDateString()}` : 'Evidence date missing'}</span></div><p><strong>Thesis:</strong> {memo.investmentThesis ?? 'No thesis narrative stored.'}</p>{memo.valuation && <p><strong>DCF scenario:</strong> {memo.valuation.currency} {memo.valuation.fairValuePerShare.toLocaleString(undefined, { maximumFractionDigits: 2 })} per share{memo.valuation.terminalShare != null ? ` · terminal value ${(memo.valuation.terminalShare * 100).toFixed(0)}% of EV` : ''}</p>}<p className="note"><strong>Catalysts:</strong> {memo.catalysts.join(' · ') || 'Not recorded'}</p><p className="caveat"><strong>Risks:</strong> {memo.risks.join(' · ') || 'Not recorded'}</p><p className="note"><strong>Evidence gaps:</strong> {memo.gaps.join(' · ') || 'None recorded'}</p>{memo.journal && <details><summary>Original decision journal</summary><p><strong>Reason:</strong> {memo.journal.decisionReason}</p><p><strong>Horizon:</strong> {memo.journal.expectedHoldingPeriod}</p><p><strong>Valuation view:</strong> {memo.journal.valuationView}</p><p><strong>Invalidation:</strong> {memo.journal.invalidationTrigger}</p></details>}</article>)}</div>}
    </section>

    <section className="card governance-section"><h2>Monitoring coverage</h2><div className="governance-coverage">{data.monitoringCoverage.map((item) => <article key={item.capability}><strong>{item.capability}</strong><span className={`badge ${item.status === 'active' ? 'ok' : 'watch'}`}>{item.status.replace('_', ' ')}</span><p>{item.detail}</p></article>)}</div></section>

    <section className="card governance-section"><h2>Provider health</h2><p className="note">Aggregated call outcomes are operational diagnostics; no credentials or request payloads are exposed here.</p>{data.providerHealth.length === 0 ? <p className="note">No provider calls have been recorded.</p> : <div className="table-scroll"><table><thead><tr><th>Provider</th><th>Endpoint</th><th>OK</th><th>Errors</th><th>Plan limits</th><th>Rate limits</th><th>Last call</th></tr></thead><tbody>{data.providerHealth.map((item) => <tr key={`${item.provider}:${item.endpoint}`}><td>{item.provider}</td><td><code>{item.endpoint}</code></td><td>{item.ok}</td><td>{item.errors}</td><td>{item.planLimits}</td><td>{item.rateLimited}</td><td>{new Date(item.lastCalledAt).toLocaleString()}</td></tr>)}</tbody></table></div>}</section>

    <section className="card governance-section" id="decision-history"><h2>Thesis and decision history</h2><p className="note">Historical decisions remain append-only. Optional monitoring guardrails now sit with the investment thesis.</p><div className="governance-versioning"><div><strong>Thesis history</strong>{data.versioning.thesisVersions.map((thesis) => <p key={thesis.version}>Version {thesis.version} · effective {new Date(thesis.effectiveDate).toLocaleDateString()}{thesis.excludedAt ? ' · excluded' : thesis.supersededAt ? ' · superseded' : ' · active'}</p>)}</div><div><strong>Recent immutable decisions</strong>{data.versioning.decisions.map((decision, index) => <p key={`${decision.date}:${index}`}>{new Date(decision.date).toLocaleDateString()} · {decision.decision} · {decision.title}{decision.metadata?.thesisVersionId ? ' · thesis snapshot retained' : ''}</p>)}{isPlatformAdmin && <Link className="text-link" href="/decisions">Search full decision log →</Link>}</div></div><Link className="text-link" href="/investment-thesis#portfolio-guardrails">Review optional thesis guardrails →</Link></section>
  </main>;
}
