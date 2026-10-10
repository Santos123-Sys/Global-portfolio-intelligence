'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Workspace, defaultProfile, type Profile } from '@/lib/foundation/contracts';
import type { Workspace as WorkspaceData } from '@/lib/foundation/contracts';
import type { ScreenResult } from '@/lib/foundation/screening';
import type { researchWorkbench } from '@/lib/foundation/research';
import type { FilingLensReadState } from '@/lib/integrations/filinglens-client';
import seed from '../../data/usa-cvm-universe.json';

type Job = { id: string; kind: 'screen' | 'research'; status: string; created_at: string; error_code: string | null;
  output: { kind: 'screen'; screens: ScreenResult[] } | { kind: 'research'; report: ReturnType<typeof researchWorkbench>; modelStatus: string } | null };
type State = { workspace: WorkspaceData; jobs: Job[]; integrations: { finance: string; researchModel: string } };
type FinancePreview = { candidateKey: string; finance: FilingLensReadState };
async function fetchState(url: string): Promise<State> {
  const res = await fetch(url, { cache: 'no-store' }); const data = await res.json();
  if (res.status === 401) throw new Error('Sign-in required; return to /login');
  if (!res.ok) throw new Error(data.error ?? 'Workspace unavailable'); return data;
}
export default function Workbench() {
  const router = useRouter();
  const { data, error, mutate } = useSWR<State>('/api/foundation', fetchState, { refreshInterval: 5000, shouldRetryOnError: false });
  const [tab, setTab] = useState('Candidates'); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<WorkspaceData | null>(null); const [json, setJson] = useState('');
  const [financePreview, setFinancePreview] = useState<FinancePreview | null>(null);
  const [financeBusy, setFinanceBusy] = useState<string | null>(null);
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
  async function viewFilingLens(candidateKey: string) {
    setFinanceBusy(candidateKey); setFinancePreview(null);
    try {
      const response = await fetch(`/api/integrations/filinglens/issuer?candidateKey=${encodeURIComponent(candidateKey)}`, { cache: 'no-store' });
      const result = await response.json();
      if (!result.finance) throw new Error(result.error ?? 'FilingLens preview is unavailable');
      setFinancePreview(result as FinancePreview);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'FilingLens preview is unavailable');
    } finally { setFinanceBusy(null); }
  }
  async function launch(kind: 'screen' | 'research', candidateKey?: string) {
    const result = await call('POST', { kind, candidateKey, idempotencyKey: crypto.randomUUID(), workspace });
    if (result) { setMessage('Job queued. The worker will retain a source-linked evidence snapshot.'); setTab('Activity'); }
  }
  return <div className="app"><header className="topbar"><div className="brand">GPI<span>DISCOVERY & RESEARCH</span></div>
    <div className="actions"><span className="muted">Foundation / 01</span><button className="secondary" onClick={async () => { await fetch('/api/auth/session', { method: 'DELETE' }); router.replace('/login'); router.refresh(); }}>Sign out</button></div></header>
    <section className="hero"><div><div className="eyebrow">FOCUSED EQUITY INTELLIGENCE</div><h1>Find candidates.<br />Challenge the evidence.</h1><p className="muted">GPI screens and researches. FilingLens owns the numbers and valuation.</p></div>
      <div className="scope"><span className="badge">USA / SEC</span><span className="badge">BRAZIL / CVM</span><span className="badge">NO AUTOMATIC TRADES</span></div></section>
    {error && <div role="alert" className="notice">{error.message}. The starter watchlist below is not a completed screening run.</div>}
    {message && <div role="status" className="notice">{message}</div>}
    <nav className="tabs" role="tablist" aria-label="Research workspace">{['Candidates', 'Investor profile', 'Research', 'Activity'].map(t => <button role="tab" key={t} aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}</nav>
    {tab === 'Candidates' && <div className="grid"><section className="card"><div className="section-head"><h2>Candidate watchlist</h2><button disabled={busy || !data} onClick={() => launch('screen')}>Run screening</button></div>
      <p className="muted">A sourced starter list, not the full market universe. Unmapped issuers stay unknown.</p>
      <div className="table-wrap"><table><thead><tr><th>COMPANY / LISTING</th><th>MARKET</th><th>LATEST RUN</th><th>FILINGLENS</th><th>RESEARCH</th></tr></thead><tbody>{workspace.candidates.map(c => {
        const screen = screens.find(s => s.candidate.key === c.key); return <tr key={c.key}><td><strong>{c.ticker}</strong><small>{c.name}</small><a href={c.identitySourceUrl} target="_blank" rel="noreferrer">Identity source</a></td>
          <td>{c.market === 'us' ? 'SEC' : 'CVM'}<small>{c.exchange}</small></td><td><span className={`badge ${screen?.status ?? 'UNKNOWN'}`}>{screen?.status ?? 'NOT SCREENED'}</span>{screen?.decisions.filter(d => d.status === 'UNKNOWN' || d.status === 'FAIL').map(d => <small key={d.stage}>{d.stage}: {d.reason}</small>)}</td>
          <td><button className="secondary" disabled={Boolean(financeBusy) || !data} onClick={() => viewFilingLens(c.key)}>{financeBusy === c.key ? 'Loading facts…' : 'View financial facts'}</button></td>
          <td><button className="secondary" disabled={busy || !data} onClick={() => launch('research', c.key)}>Evidence pack</button></td></tr>; })}</tbody></table></div>
      {!workspace.candidates.length && <p>No candidates. Import a USA/CVM list below.</p>}
      {financePreview && <div className="callout" aria-live="polite"><h3>FilingLens · {financePreview.candidateKey}</h3>
        {financePreview.finance.status !== 'ready' ? <p>Financial evidence unavailable: {financePreview.finance.reason}. Missing data does not pass screening.</p> : <>
          <p><strong>Public regulatory facts</strong> · {financePreview.finance.snapshot.issuer.jurisdiction.toUpperCase()} {financePreview.finance.snapshot.issuer.registryId}</p>
          <small>Archived {financePreview.finance.snapshot.archivedOn} · Snapshot {financePreview.finance.snapshot.snapshotId}</small>
          <div className="table-wrap"><table><thead><tr><th>METRIC</th><th>PERIOD</th><th>REPORTED VALUE / UNIT</th><th>EVIDENCE</th></tr></thead><tbody>
            {financePreview.finance.snapshot.facts.slice(0, 30).map(fact => <tr key={fact.id}><td>{fact.metric}<small>{fact.status}</small></td><td>{fact.periodEnd ?? fact.periodLabel ?? fact.fiscalYear}</td>
              <td>{fact.value ?? 'Unknown'} {fact.unit ?? ''}</td><td>{fact.sources.map((source, index) => <small key={index}><a href={source.url} target="_blank" rel="noreferrer">Regulator source</a></small>)}</td></tr>)}</tbody></table></div>
          {financePreview.finance.snapshot.facts.length > 30 && <small>Showing 30 of {financePreview.finance.snapshot.facts.length} facts. Run an evidence pack for the full source set.</small>}
          {financePreview.finance.snapshot.limitations.map((limitation, i) => <small key={i}>{limitation}</small>)}
          <small>FilingLens provides all figures; GPI does not recalculate them. No valuation is approved by this preview.</small>
        </>}
      </div>}</section><aside><section className="card"><h2>Authority boundary</h2><p>Financial facts and derived indicators come from FilingLens. GPI does not compute valuation, portfolio weights or risk metrics.</p>
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
        <div className="section-head"><h3>{r.candidate.ticker} · {r.candidate.name}</h3><span className="badge">HUMAN REVIEW REQUIRED</span></div><small>{j.output.modelStatus} · <code>{j.id}</code></small>
        <div className="columns">{(['bull', 'bear'] as const).map(side => <div key={side}><h3>{side === 'bull' ? 'Positive case' : 'Countercase'}</h3>{r.questions[side].map(q => <p key={q}>{q}</p>)}
          {r.draft?.[side].map((claim, i) => <div className="claim" key={i}><p>{claim.text}</p><small>Falsifier: {claim.falsifier}</small><small className="break">Evidence: {claim.evidenceIds.join(', ')}</small></div>)}</div>)}</div>
        <h3>FilingLens evidence</h3>{r.screen.finance.status !== 'ready' ? <div className="notice">{r.screen.finance.reason}</div> : <><small className="break">Snapshot: {r.screen.finance.snapshot.snapshotId}</small><div className="table-wrap"><table><thead><tr><th>METRIC</th><th>PERIOD</th><th>SOURCE VALUE / UNIT</th><th>STATUS / SOURCE</th></tr></thead><tbody>{r.screen.finance.snapshot.facts.map(f => <tr key={f.id}><td>{f.metric}</td><td>{f.periodEnd ?? f.periodLabel ?? f.fiscalYear}</td><td><span>{f.value ?? 'Unknown'} {f.unit ?? ''}</span>{f.currency !== f.unit && <small>{f.currency ?? 'Currency not supplied'}</small>}</td><td>{f.status}{f.sources.map((s, i) => <small key={i}><a href={s.url} target="_blank" rel="noreferrer">Regulator source</a></small>)}</td></tr>)}</tbody></table></div></>}
        <div className="callout">{r.valuation.reason}</div>{r.limitations.map((l, i) => <small key={i}>• {l}</small>)}</article>; })}</section>}
    {tab === 'Activity' && <section className="card"><div className="section-head"><h2>Durable job activity</h2><button className="secondary" onClick={() => mutate()}>Refresh</button></div><p className="muted">Jobs require the foundation worker. A stopped worker leaves jobs queued; it does not simulate completion.</p>
      {!jobs.length && <p>No jobs yet.</p>}<div className="table-wrap"><table><thead><tr><th>RUN</th><th>TYPE</th><th>STATUS</th><th>CREATED / ERROR</th></tr></thead><tbody>{jobs.map(j => <tr key={j.id}><td><code>{j.id}</code></td><td>{j.kind}</td><td><span className={`badge ${j.status}`}>{j.status}</span></td><td>{new Date(j.created_at).toLocaleString()}<small>{j.error_code ?? ''}</small></td></tr>)}</tbody></table></div></section>}
    <footer>USA and Brazil CVM only · No Swiss coverage · No internal financial calculators · No automatic trading</footer></div>;
}
