'use client';
import { useState,useEffect } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Workspace, defaultProfile, type Profile } from '@/lib/foundation/contracts';
import type { Workspace as WorkspaceData } from '@/lib/foundation/contracts';
import type { ScreenResult } from '@/lib/foundation/screening';
import type { researchWorkbench } from '@/lib/foundation/research';
import seed from '../../data/usa-cvm-universe.json';
import { IssuerStatementPreview } from './issuer-statement-preview';
import { ResearchHub, ResearchManagerReport } from './research-hub';
import { CorpusLibrary } from './corpus-library';
import {InvestmentWorkspace} from './investment-workspace';
import { PortfolioHub } from './portfolio-hub';
import {MarketHistoryPanel} from './market-history-panel';
import {researchState,financeRecovery} from '@/lib/foundation/research-state';
import type { ResearchBrief } from '@/lib/research/contracts';

type Job = { id: string; kind: 'screen' | 'research'; status: string; created_at: string; error_code: string | null;
  output: { kind: 'screen'; screens: ScreenResult[] } | { kind: 'research'; report: ReturnType<typeof researchWorkbench>; modelStatus: string } | null };
type State = { workspace: WorkspaceData; jobs: Job[]; integrations: { finance: string; researchModel: string } };
type Handoff = { reviewId: string; candidateKey: string; decision: string; reviewedAt: string;
  exportStatus: string; issuer: { issuerId: string } | null };
type HandoffState = { reviews: Handoff[]; delivery: string };
async function fetchHandoffs(url: string): Promise<HandoffState> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Handoff history unavailable');
  return res.json();
}
async function fetchState(url: string): Promise<State> {
  const res = await fetch(url, { cache: 'no-store' }); const data = await res.json();
  if (res.status === 401) throw new Error('Sign-in required; return to /login');
  if (!res.ok) throw new Error(data.error ?? 'Workspace unavailable'); return data;
}
export default function Workbench() {
  const router = useRouter();
  const { data, error, mutate } = useSWR<State>('/api/foundation', fetchState, { refreshInterval: 5000, shouldRetryOnError: false });
  const [workspaceCompany,setWorkspaceCompany]=useState('');
  const [tab, setTab] = useState('Workspace'); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<WorkspaceData | null>(null); const [json, setJson] = useState('');
  const { data: handoffs, mutate: refreshHandoffs } = useSWR<HandoffState>('/api/integration/v1/reviews', fetchHandoffs,
    { refreshInterval: 10000, shouldRetryOnError: false });
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [mappingChecks, setMappingChecks] = useState<Record<string, boolean>>({});
  const [portfolioQuestion,setPortfolioQuestion]=useState<{candidateKey:string;question:string}>();
  useEffect(()=>{const hash=new URLSearchParams(window.location.hash.slice(1));if(hash.has('valuation')||hash.has('portfolio'))setTab('Portfolio');},[]);
  const workspace = edit ?? data?.workspace ?? Workspace.parse({ version: 1, profile: defaultProfile, candidates: seed.candidates });
  const jobs = data?.jobs ?? []; const latestScreen = jobs.find(j => j.status === 'complete' && j.output?.kind === 'screen');
  const screens = latestScreen?.output?.kind === 'screen' ? latestScreen.output.screens : [];
  const reports = jobs.filter(j => j.output?.kind === 'research');
  function profileChange(change: Partial<Profile>) { setEdit({ ...workspace, profile: { ...workspace.profile, ...change } }); }
  async function call(method: string, body: unknown) {
    setBusy(true); setMessage('');
    try { const res = await fetch('/api/foundation', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await res.json(); if (!res.ok) throw new Error(result.error ?? 'Request unavailable'); await mutate(); return result;
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Request failed'); return null; } finally { setBusy(false); }
  }
  async function launch(kind: 'screen' | 'research', candidateKey?: string, brief?: ResearchBrief) {
    setTab('Activity');
    const result = await call('POST', { kind, candidateKey, brief, idempotencyKey: crypto.randomUUID(), workspace });
    if (result) setMessage('Job queued. The worker will retain a source-linked evidence snapshot.');
  }
  async function recordReview(jobId: string, decision: 'request_analysis' | 'watchlist' | 'reject') {
    const rationale = (reviewNotes[jobId] ?? '').trim();
    if (rationale.length < 20) { setMessage('Review justification requires at least 20 characters.'); return; }
    setBusy(true); setMessage('');
    try {
      const res = await fetch('/api/integration/v1/reviews', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceResearchJobId: jobId, decision, rationale,
          confirmIssuerMapping: mappingChecks[jobId] === true, idempotencyKey: crypto.randomUUID() }),
      });
      const value = await res.json();
      if (!res.ok) throw new Error(value.error ?? 'Review unavailable');
      await refreshHandoffs();
      setMessage('Human review saved in GPI. External delivery is disabled until providers are ready.');
      setTab('Handoffs');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Review failed'); }
    finally { setBusy(false); }
  }
  return <div className="app"><header className="topbar"><div className="brand">GPI<span>INVESTMENT WORKSPACE</span></div>
    <div className="actions"><span className="muted">Research · Financials · Risk</span><button className="secondary" onClick={async () => { await fetch('/api/auth/session', { method: 'DELETE' }); router.replace('/login'); router.refresh(); }}>Sign out</button></div></header>
    <section className="hero"><div><div className="eyebrow">FOCUSED EQUITY INTELLIGENCE</div><h1>Research companies.<br />Review value and risk.</h1><p className="muted">One workspace for research, FilingLens financial analysis and Portfolio Risk Studio analytics.</p></div>
      <div className="scope"><span className="badge">USA / SEC</span><span className="badge">BRAZIL / CVM</span><span className="badge">NO AUTOMATIC TRADES</span></div></section>
    {error && <div role="alert" className="notice">{error.message}. The starter watchlist below is not a completed screening run.</div>}
    {message && <div role="status" className="notice">{message}</div>}
    <nav className="tabs" role="tablist" aria-label="Research workspace">{['Workspace', 'Candidates', 'Investor profile', 'Research Hub', 'Research', 'Handoffs', 'Portfolio', 'Activity'].map(t => <button role="tab" key={t} aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}</nav>
    {tab === 'Workspace' && <InvestmentWorkspace candidates={workspace.candidates} selectedKey={workspaceCompany} onSelectCompany={setWorkspaceCompany} onResearch={(candidateKey,question)=>{setPortfolioQuestion({candidateKey,question});setTab('Research Hub');}}/>}
    {tab === 'Portfolio' && <PortfolioHub candidates={workspace.candidates} onResearch={(candidateKey,question)=>{setPortfolioQuestion({candidateKey,question});setTab('Research Hub');}}/>}
    {tab === 'Research Hub' && <><ResearchHub initial={portfolioQuestion} candidates={workspace.candidates} disabled={busy || !data}
      onLaunch={async (key, brief) => launch('research', key, brief)} /><CorpusLibrary candidates={workspace.candidates}/></>}
    {tab === 'Candidates' && <div className="grid"><section className="card"><div className="section-head"><h2>Candidate watchlist</h2><button disabled={busy || !data} onClick={() => launch('screen')}>Run screening</button></div>
      <p className="muted">A sourced starter list, not the full market universe. Unmapped issuers stay unknown.</p>
      <div className="table-wrap"><table><thead><tr><th>COMPANY / LISTING</th><th>MARKET</th><th>LATEST RUN</th><th>RESEARCH</th></tr></thead><tbody>{workspace.candidates.map(c => {
        const screen = screens.find(s => s.candidate.key === c.key); return <tr key={c.key}><td><strong>{c.ticker}</strong><small>{c.name}</small><a href={c.identitySourceUrl} target="_blank" rel="noreferrer">Identity source</a></td>
          <td>{c.market === 'us' ? 'SEC' : 'CVM'}<small>{c.exchange}</small></td><td><span className={`badge ${screen?.status ?? 'UNKNOWN'}`}>{screen?.status ?? 'NOT SCREENED'}</span>{screen?.decisions.filter(d => d.status === 'UNKNOWN' || d.status === 'FAIL').map(d => <small key={d.stage}>{d.stage}: {d.reason}</small>)}</td>
          <td><button className="secondary" disabled={busy || !data} onClick={() => launch('research', c.key)}>Evidence pack</button>{c.key === 'XNAS:AAPL' && c.ticker === 'AAPL' && c.market === 'us' && (!c.issuer || (c.issuer.jurisdiction === 'us' && c.issuer.registryId === '0000320193')) && <IssuerStatementPreview candidateKey={c.key} />}</td></tr>; })}</tbody></table></div>
      {!workspace.candidates.length && <p>No candidates. Import a USA/CVM list below.</p>}</section><aside><section className="card"><h2>Authority boundary</h2><p>Financial facts and derived indicators come from FilingLens. GPI does not compute valuation, portfolio weights or risk metrics.</p>
        <div className="callout">Finance reads: <strong>{data?.integrations.finance ?? 'not verified'}</strong><br />Research drafts: <strong>{data?.integrations.researchModel ?? 'not verified'}</strong></div><small>Configured does not mean connected. Each job validates issuer identity, source domains, schema and payload hash.</small></section>
      <section className="card"><h2>Manage the watchlist</h2><p className="muted">Import listing identities, not financial figures. CIK/CNPJ mappings must be independently checked.</p>
        <details><summary>Import candidate JSON</summary><textarea aria-label="Candidate JSON" value={json} onChange={e => setJson(e.target.value)} placeholder='[{"key":"XNAS:…","name":"…","ticker":"…","exchange":"XNAS","market":"us","issuer":null,"identitySourceUrl":"https://…"}]' />
          <button disabled={busy || !data} onClick={async () => { try { const next = Workspace.parse({ ...workspace, candidates: JSON.parse(json) }); if (await call('PUT', next)) { setEdit(null); setJson(''); } } catch { setMessage('Invalid candidate list. USA/SEC and Brazil/CVM only; unique listing keys required.'); } }}>Validate and save</button></details>
        <small>Maximum 100 saved candidates; screen batches are limited to 20. Narrow an imported list before launching.</small></section></aside></div>}
    {tab === 'Investor profile' && <div className="grid"><form className="card" onSubmit={async e => { e.preventDefault(); if (await call('PUT', workspace)) { setEdit(null); setMessage('Investor profile saved. Existing job evidence remains unchanged.'); } }}><h2>Investor profile</h2>
      <label>Profile name<input value={workspace.profile.name} required maxLength={100} onChange={e => profileChange({ name: e.target.value })} /></label>
      <label>Objective<select value={workspace.profile.objective} onChange={e => profileChange({ objective: e.target.value as Profile['objective'] })}><option value="growth">Growth</option><option value="income">Income — additional evidence required</option><option value="preservation">Preservation — additional evidence required</option></select></label>
      <fieldset><legend>Markets</legend>{(['us', 'br'] as const).map(m => <label key={m}><input type="checkbox" checked={workspace.profile.markets.includes(m)} onChange={e => profileChange({ markets: e.target.checked ? [...workspace.profile.markets, m] : workspace.profile.markets.filter(v => v !== m) })} />{m === 'us' ? 'USA / SEC' : 'Brazil / CVM'}</label>)}</fieldset>
      <div className="form-grid"><label>Minimum annual revenue growth (%)<input type="number" min={-100} max={1000} step="any" value={workspace.profile.minimumRevenueGrowthPct ?? ''} onChange={e => profileChange({ minimumRevenueGrowthPct: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        <label>Maximum evidence age (days)<input type="number" min={30} max={730} value={workspace.profile.maxEvidenceAgeDays} onChange={e => profileChange({ maxEvidenceAgeDays: Number(e.target.value) })} /></label></div>
      <label>Minimum average daily traded shares (optional)<input type="number" min={0} step="any" value={workspace.profile.minimumAverageDailyShares ?? ''} onChange={e => profileChange({ minimumAverageDailyShares: e.target.value === '' ? null : Number(e.target.value) })} /></label>
      <button disabled={busy || !data}>Save profile</button></form><aside className="card"><h2>Unknown is a result</h2><p>Missing, conflicting, stale or unsupported data never passes a requested gate.</p><p>Liquidity requires a market-data contract. Income and preservation require additional external indicators. Selecting them currently produces an explicit unknown.</p><small>Changing a profile does not rewrite prior job snapshots.</small></aside></div>}
    {tab === 'Research' && <section className="card"><h2>Evidence-based research</h2><p className="muted">Evidence packs remain available without an LLM. Optional drafts are unapproved hypotheses, not recommendations.</p>
      {!reports.length && <div className="callout">Choose “Evidence pack” on a candidate to start.</div>}{reports.map(j => { if (j.output?.kind !== 'research') return null; const r = j.output.report; return <article className="evidence" key={j.id}>
        <div className="section-head"><h3>{r.candidate.ticker} · {r.candidate.name}</h3><span className="badge">HUMAN REVIEW REQUIRED</span></div>
        <p role="status">{researchState(j.output.modelStatus)}</p><small>Saved {new Date(j.created_at).toLocaleString()} · <code>{j.id}</code></small>
        {r.screen.finance.status!=='ready'&&<div className="notice"><p>{financeRecovery(r.screen.finance.status)}</p><p>Current connection: {data?.integrations.finance==='configured_read_attempts'?'enabled; a new read still needs validation':'disabled'}.</p>
        <button disabled={busy||!data} onClick={()=>launch('research',r.candidate.key)}>Retry evidence pack</button>
        <button className="secondary" onClick={()=>{setWorkspaceCompany(r.candidate.key);setTab('Workspace');}}>Open company financial workspace</button></div>}
        {r.deepResearch && <ResearchManagerReport run={r.deepResearch} jobId={j.id} />}
        <div className="columns">{(['bull', 'bear'] as const).map(side => <div key={side}><h3>{side === 'bull' ? 'Positive case' : 'Countercase'}</h3>{r.questions[side].map(q => <p key={q}>{q}</p>)}
          {r.draft?.[side].map((claim, i) => <div className="claim" key={i}><p>{claim.text}</p><small>Falsifier: {claim.falsifier}</small><small className="break">Evidence: {claim.evidenceIds.join(', ')}</small></div>)}</div>)}</div>
        <h3>FilingLens evidence</h3>{r.screen.finance.status !== 'ready' ? <details><summary>Saved connection diagnostic</summary><p>{r.screen.finance.reason}</p></details> : <><small className="break">Snapshot: {r.screen.finance.snapshot.snapshotId}</small><div className="table-wrap"><table><thead><tr><th>METRIC</th><th>PERIOD</th><th>SOURCE VALUE / UNIT</th><th>STATUS / SOURCE</th></tr></thead><tbody>{r.screen.finance.snapshot.facts.map(f => <tr key={f.id}><td>{f.metric}</td><td>{f.periodEnd ?? f.periodLabel ?? f.fiscalYear}</td><td><span>{f.value ?? 'Unknown'} {f.unit ?? ''}</span>{f.currency !== f.unit && <small>{f.currency ?? 'Currency not supplied'}</small>}</td><td>{f.status}{f.sources.map((s, i) => <small key={i}><a href={s.url} target="_blank" rel="noreferrer">Regulator source</a></small>)}</td></tr>)}</tbody></table></div></>}
        <MarketHistoryPanel candidate={r.candidate}/>
        <div className="callout">{r.valuation.reason}</div>{r.limitations.map((l, i) => <small key={i}>• {l}</small>)}
        <section className="callout"><h3>Human thesis review · GPI only</h3>
          <p>Reviewing creates a local audit record, not a FilingLens job, portfolio holding or trade.</p>
          <label>Analyst rationale<textarea aria-label={'Review rationale ' + j.id}
            value={reviewNotes[j.id] ?? ''} maxLength={2000}
            onChange={e => setReviewNotes(v => ({ ...v, [j.id]: e.target.value }))} /></label>
          <label><input type="checkbox" checked={mappingChecks[j.id] === true}
            onChange={e => setMappingChecks(v => ({ ...v, [j.id]: e.target.checked }))} />
            I checked this issuer&apos;s CIK/CNPJ and the official source before requesting further analysis.
          </label>
          <div className="actions">
            <button disabled={busy} onClick={() => recordReview(j.id, 'request_analysis')}>Queue analysis handoff locally</button>
            <button className="secondary" disabled={busy} onClick={() => recordReview(j.id, 'watchlist')}>Keep on watchlist</button>
            <button className="secondary" disabled={busy} onClick={() => recordReview(j.id, 'reject')}>Reject idea</button>
          </div>
        </section></article>; })}</section>}
    {tab === 'Handoffs' && <section className="card"><div className="section-head">
      <h2>Reviewed investment handoffs</h2><button className="secondary" onClick={() => refreshHandoffs()}>Refresh</button>
      </div><p className="muted">These records stay inside GPI. Other systems cannot receive them until authorized endpoints and tenant scopes are verified.</p>
      <p className="muted">Delivery: {handoffs?.delivery ?? 'not connected'}</p>
      {!handoffs?.reviews.length && <p>No human-reviewed handoffs yet.</p>}
      <div className="table-wrap"><table><thead><tr><th>CANDIDATE</th><th>REVIEW DECISION</th><th>ISSUER</th><th>DATE</th><th>DELIVERY</th></tr></thead><tbody>
        {handoffs?.reviews.map(h => <tr key={h.reviewId}><td>{h.candidateKey}</td><td>{h.decision}</td>
          <td>{h.issuer?.issuerId ?? 'Unmapped'}</td><td>{new Date(h.reviewedAt).toLocaleString()}</td><td>{h.exportStatus}</td></tr>)}
      </tbody></table></div>
    </section>}
    {tab === 'Activity' && <section className="card"><div className="section-head"><h2>Durable job activity</h2><button className="secondary" onClick={() => mutate()}>Refresh</button></div><p className="muted">Jobs require the foundation worker. A stopped worker leaves jobs queued; it does not simulate completion.</p>
      {!jobs.length && <p>No jobs yet.</p>}<div className="table-wrap"><table><thead><tr><th>RUN</th><th>TYPE</th><th>STATUS</th><th>CREATED / ERROR</th></tr></thead><tbody>{jobs.map(j => <tr key={j.id}><td><code>{j.id}</code></td><td>{j.kind}</td><td><span className={`badge ${j.status}`}>{j.status}</span></td><td>{new Date(j.created_at).toLocaleString()}<small>{j.error_code ?? ''}</small></td></tr>)}</tbody></table></div></section>}
    <footer>USA and Brazil CVM only · No Swiss coverage · No internal financial calculators · No automatic trading</footer></div>;
}
