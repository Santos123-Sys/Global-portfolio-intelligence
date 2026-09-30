'use client';
import { useEffect, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AgentOutput, AnalyzeRequest } from '@/lib/agent-finance/contracts';
import {driverSchema,capitalSchema,type Drivers} from '@/lib/agent-finance/l4/financial-model';

interface Session {
  id: string; status: string; phase: string; progress: number; error?: string | null;
  agentsCompleted?: string[]; agentsPending?: string[];
  requestPayload?:AnalyzeRequest;
  finalOutput?: { status?:string; outputs: Record<string, AgentOutput>; confidenceScore: number; limitations: string[] } | null;
}
const screens: Record<string, string> = { research: 'loading_research_phase.html', analysis: 'loading_financial_analysis.html', valuation: 'loading_valuation_phase.html' };

export function AgentAnalysis({ ticker, securityId, viewer }: { ticker: string; securityId: string; viewer: boolean }) {
  const [type, setType] = useState<AnalyzeRequest['analysisType']>('combined');
  const [session, setSession] = useState<Session | null>(null);
  const [history, setHistory] = useState<Session[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [frameFailed, setFrameFailed] = useState(false);
  const [growth, setGrowth] = useState(''); const [wacc, setWacc] = useState(''); const [terminal, setTerminal] = useState('');
  const [scopes,setScopes]=useState<Array<{portfolioId:string;thesisVersionId:string;name:string}>>([]);
  const [scope,setScope]=useState('');
  const [simulation,setSimulation]=useState(false);
  const [widths,setWidths]=useState({growth:2,margin:1,wacc:1,bear:25,base:50,bull:25});
  const [review,setReview]=useState<Record<string,string>>({});
  const [accepted,setAccepted]=useState('');
  const [editDrivers,setEditDrivers]=useState(false),[editCapital,setEditCapital]=useState(false);
  const [driverInputs,setDriverInputs]=useState<Partial<Record<keyof Drivers,string>>>({});
  const [capitalInputs,setCapitalInputs]=useState<Record<string,string>>({});
  const active = session?.status === 'queued' || session?.status === 'running';
  const sessionId = session?.id;
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/agents/sessions?securityId=${encodeURIComponent(securityId)}`).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Unable to load history');
      if (!cancelled) { setHistory(body.sessions); setScopes(body.scopes ?? []); if(body.scopes?.length===1) setScope(body.scopes[0].portfolioId); if (body.sessions[0]) setSession(body.sessions[0]); }
    }).catch(e => { if (!cancelled) setError(String(e.message)); });
    return () => { cancelled = true; };
  }, [securityId]);
  useEffect(() => {
    if (!sessionId || !active) return;
    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch(`/api/agents/sessions/${sessionId}`); const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Unable to load session');
        if (!cancelled) { setSession(body); setError(''); }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Polling failed'); }
    }
    void poll(); const timer = setInterval(() => void poll(), 2500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [sessionId, active]);
  useEffect(() => setFrameFailed(false), [session?.phase]);
  useEffect(()=>{setAccepted('');setReview({});},[sessionId]);
  async function start() {
    setBusy(true); setError('');
    try {
      const body: AnalyzeRequest = { ticker, analysisType: type };
      const selected=scopes.find(row=>row.portfolioId===scope); if(selected) {body.portfolioId=selected.portfolioId;body.thesisVersionId=selected.thesisVersionId;}
      if (growth || wacc || terminal) body.userOverrides = { discountRate: wacc ? Number(wacc) / 100 : undefined,
        assumptions: { annualGrowthRate: growth ? Number(growth) / 100 : undefined, terminalGrowthRate: terminal ? Number(terminal) / 100 : undefined } };
      if(simulation) body.userOverrides={...body.userOverrides,simulation:{samples:1000,seed:42,growthWidth:widths.growth/100,marginWidth:widths.margin/100,waccWidth:widths.wacc/100,probabilities:[widths.bear/100,widths.base/100,widths.bull/100]}};
      if(editDrivers) body.userOverrides={...body.userOverrides,drivers:driverSchema.parse(Object.fromEntries(Object.entries(driverInputs).map(([key,value])=>[key,Number(value)/(key==='minimumCash' ? 1 : 100)])))};
      if(editCapital) body.userOverrides={...body.userOverrides,capitalInputs:capitalSchema.parse({...Object.fromEntries(['riskFreeRate','beta','equityRiskPremium','countryRiskPremium','costOfDebt','taxRate','debtWeight'].map(key=>[key,Number(capitalInputs[key])/(key==='beta' ? 1 : 100)])),currency:capitalInputs.currency,asOf:capitalInputs.asOf,sources:(capitalInputs.sources ?? '').split('\n').filter(Boolean)})};
      const response = await fetch('/api/agents/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Unable to start');
      setSession({ id: result.sessionId, status: result.status, phase: 'research', progress: 0 });
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to start'); } finally { setBusy(false); }
  }
  const outputs = session?.finalOutput?.outputs;
  const sensitivity = outputs?.['sensitivity-analyst']?.data.scenarios as Array<{ scenario: string; fairValuePerShare: number }> | undefined;
  const sensitivityData=outputs?.['sensitivity-analyst']?.data;
  const matrix=sensitivityData?.matrix as Array<{discountRate:number;terminalGrowthRate:number;fairValuePerShare:number|null}> | undefined;
  const tornado=sensitivityData?.tornado as Array<{driver:string;low:number;high:number}> | undefined;
  const monteCarlo=sensitivityData?.monteCarlo as {p5:number;p50:number;p95:number;histogram:Array<{value:number;count:number}>} | null | undefined;
  const projection=outputs?.['projection-builder']?.data.projections as Array<{year:number;incomeStatement:{revenue:number;ebit:number;netIncome:number};balanceSheet:{totalAssets:number;totalLiabilities:number;equity:number;cash:number};cashFlow:{fcff:number};checks:{balanceError:number;cashError:number}}> | undefined;
  const acceptable=session?.finalOutput?.status==='completed' && session.finalOutput.confidenceScore>=60 && !!outputs?.['judge-agent'] && !!session.requestPayload?.portfolioId;
  async function accept() {
    setBusy(true);setError('');
    try {
      const score=(key:string)=>Number(review[key]);
      const list=(key:string)=>(review[key] ?? '').split('\n').map(v=>v.trim()).filter(Boolean);
      const response=await fetch(`/api/agents/sessions/${session!.id}/accept`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmed:true,summary:review.summary,investmentThesis:review.investmentThesis,portfolioRole:review.portfolioRole,investmentScore:score('investmentScore'),thesisAlignmentScore:score('thesisAlignmentScore'),qualityScore:score('qualityScore'),growthScore:score('growthScore'),riskScore:score('riskScore'),keyCatalysts:list('keyCatalysts'),keyRisks:list('keyRisks'),thesisBreakers:list('thesisBreakers')})});
      const body=await response.json();if(!response.ok) throw new Error(body.error);setAccepted(body.analysisId);
    } catch(e) {setError(e instanceof Error ? e.message : 'Acceptance failed');} finally {setBusy(false);}
  }
  return <section className="card glow-card">
    <h2>Agent Analysis</h2>
    <p className="note">Research Director · DCF Swarm · Analysis Swarm. Evidence-backed research, never automatic trading.</p>
    {!viewer && <div className="form-grid">
      {scopes.length>0 && <label>Portfolio and active thesis<select value={scope} onChange={e=>setScope(e.target.value)}><option value="">Select portfolio</option>{scopes.map(row=><option key={`${row.portfolioId}:${row.thesisVersionId}`} value={row.portfolioId}>{row.name}</option>)}</select></label>}
      <label>Analysis type<select value={type} onChange={e => setType(e.target.value as AnalyzeRequest['analysisType'])}><option value="combined">Combined research</option><option value="dcf">DCF valuation</option><option value="fundamental">Financial analysis</option><option value="quick">Quick analysis (no debate)</option></select></label>
      <label>Revenue growth override (%)<input type="number" min="-50" max="50" step=".1" value={growth} onChange={e => setGrowth(e.target.value)} placeholder="Otherwise estimates / historical trend" /></label>
      <label>WACC override (%)<input type="number" min=".1" max="50" step=".1" value={wacc} onChange={e => setWacc(e.target.value)} placeholder="Otherwise sourced CAPM" /></label>
      <label>Terminal growth (%)<input type="number" min="-5" max="5" step=".1" value={terminal} onChange={e => setTerminal(e.target.value)} placeholder="Required for DCF" /></label>
      <button className="action-button" disabled={busy || active} onClick={() => void start()}>{busy ? 'Starting…' : 'Start analysis'}</button>
      <label><input type="checkbox" checked={simulation} onChange={e=>setSimulation(e.target.checked)}/>Review simulation policy</label>
      {simulation && <><p className="note">Independent triangular distributions around base drivers. These are modeling assumptions, not probabilities inferred from market data.</p>{Object.entries(widths).map(([key,value])=><label key={key}>{key} {['growth','margin','wacc'].includes(key) ? 'distribution half-width (percentage points)' : 'scenario probability (%)'}<input type="number" step=".1" min="0" value={value} onChange={e=>setWidths({...widths,[key]:Number(e.target.value)})}/></label>)}</>}
      <label><input type="checkbox" checked={editDrivers} onChange={e=>setEditDrivers(e.target.checked)}/>Review projection policies</label>
      {editDrivers && (['growth','operatingMargin','depreciationRatio','capexRatio','workingCapitalRatio','taxRate','debtRate','payoutRatio','minimumCash'] as Array<keyof Drivers>).map(key=><label key={key}>{key} {key==='minimumCash' ? '(native currency)' : '(%)'}<input type="number" step=".1" value={driverInputs[key] ?? ''} onChange={e=>setDriverInputs({...driverInputs,[key]:e.target.value})}/></label>)}
      <label><input type="checkbox" checked={editCapital} onChange={e=>setEditCapital(e.target.checked)}/>Review CAPM inputs and sources</label>
      {editCapital && <>{['riskFreeRate','beta','equityRiskPremium','countryRiskPremium','costOfDebt','taxRate','debtWeight'].map(key=><label key={key}>{key} {key==='beta' ? '' : '(%)'}<input type="number" step=".01" value={capitalInputs[key] ?? ''} onChange={e=>setCapitalInputs({...capitalInputs,[key]:e.target.value})}/></label>)}<label>Currency (ISO code)<input value={capitalInputs.currency ?? ''} onChange={e=>setCapitalInputs({...capitalInputs,currency:e.target.value.toUpperCase()})}/></label><label>Source date<input type="date" value={capitalInputs.asOf ?? ''} onChange={e=>setCapitalInputs({...capitalInputs,asOf:e.target.value})}/></label><label>Source URLs (one per line)<textarea value={capitalInputs.sources ?? ''} onChange={e=>setCapitalInputs({...capitalInputs,sources:e.target.value})}/></label></>}
    </div>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {active && <div role="status" aria-live="polite">
      {!frameFailed ? <iframe src={`/loading/${screens[session?.phase ?? 'research'] ?? screens.research}`} title={`Agent phase: ${session?.phase}`} sandbox="" onError={() => setFrameFailed(true)} style={{ width: '100%', height: 280, border: 0, borderRadius: 12 }} /> : <p>Processing {session?.phase}…</p>}
      <progress value={session?.progress ?? 0} max={100} aria-label="Completed agent tasks" />
      <p>{session?.progress ?? 0}% · {session?.agentsCompleted?.length ?? 0} agents finished. Live status, not a time estimate.</p>
    </div>}
    {session?.status === 'failed' && <p role="alert">{session.error ?? 'Analysis failed. Start a new run.'}</p>}
    {outputs && <>
      <p className="caveat">Human review required · Evidence confidence {session.finalOutput!.confidenceScore}/100</p>
      {sensitivity && <ResponsiveContainer width="100%" height={260}><BarChart data={sensitivity}><XAxis dataKey="scenario"/><YAxis/><Tooltip/><Bar dataKey="fairValuePerShare" fill="#14b8a6"/></BarChart></ResponsiveContainer>}
      {matrix && <details><summary>WACC / terminal growth sensitivity</summary><div className="table-scroll"><table><thead><tr><th>WACC</th><th>Terminal growth</th><th>Value per share</th></tr></thead><tbody>{matrix.map((row,i)=><tr key={i}><td>{(row.discountRate*100).toFixed(2)}%</td><td>{(row.terminalGrowthRate*100).toFixed(2)}%</td><td>{row.fairValuePerShare?.toFixed(2) ?? 'Invalid rates'}</td></tr>)}</tbody></table></div></details>}
      {tornado && <><h3>Driver sensitivity</h3><ResponsiveContainer width="100%" height={260}><BarChart data={tornado} layout="vertical"><XAxis type="number"/><YAxis type="category" dataKey="driver" width={140}/><Tooltip/><Bar dataKey="low" fill="#22c55e"/><Bar dataKey="high" fill="#14b8a6"/></BarChart></ResponsiveContainer></>}
      {monteCarlo && <><h3>Monte Carlo valuation distribution</h3><p>5th / 50th / 95th percentiles: {monteCarlo.p5.toFixed(2)} / {monteCarlo.p50.toFixed(2)} / {monteCarlo.p95.toFixed(2)}</p><ResponsiveContainer width="100%" height={260}><BarChart data={monteCarlo.histogram}><XAxis dataKey="value" tickFormatter={v=>Number(v).toFixed(1)}/><YAxis/><Tooltip/><Bar dataKey="count" fill="#14b8a6"/></BarChart></ResponsiveContainer></>}
      {projection && <><h3>Reconciled three-statement projection</h3><div className="table-scroll"><table><thead><tr>{['Year','Revenue','EBIT','Net income','Assets','Liabilities','Equity','Cash','FCFF','BS error','CF error'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{projection.map(row=><tr key={row.year}>{[row.year,row.incomeStatement.revenue,row.incomeStatement.ebit,row.incomeStatement.netIncome,row.balanceSheet.totalAssets,row.balanceSheet.totalLiabilities,row.balanceSheet.equity,row.balanceSheet.cash,row.cashFlow.fcff,row.checks.balanceError,row.checks.cashError].map((v,i)=><td key={i}>{v.toFixed(2)}</td>)}</tr>)}</tbody></table></div></>}
      {acceptable && !viewer && <details className="card"><summary>Review and accept into portfolio analysis history</summary><p>Review each conclusion and score. Acceptance creates a version linked to this session’s thesis and preserves the previous analysis.</p><div className="form-grid">{['summary','investmentThesis','portfolioRole','investmentScore','thesisAlignmentScore','qualityScore','growthScore','riskScore','keyCatalysts','keyRisks','thesisBreakers'].map(key=><label key={key}>{key}{key.endsWith('Score') ? <input required type="number" min="0" max="100" value={review[key] ?? ''} onChange={e=>setReview({...review,[key]:e.target.value})}/> : <textarea required value={review[key] ?? ''} onChange={e=>setReview({...review,[key]:e.target.value})}/>}</label>)}</div><button className="action-button" disabled={busy || !!accepted} onClick={()=>void accept()}>Confirm reviewed report and accept</button>{accepted && <p role="status">Accepted analysis: {accepted}</p>}</details>}
      {Object.entries(outputs).map(([name, output]) => <details key={name} className="card">
        <summary>{name.replaceAll('-', ' ')} · {output.status.replaceAll('_', ' ')} · {output.confidenceScore}/100</summary>
        <h3>Evidence and calculation summary</h3><ul>{output.reasoningChain.map((item, i) => <li key={i}>{item}</li>)}</ul>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(output.data, null, 2)}</pre>
        {output.limitations.length > 0 && <><h4>Limitations</h4><ul>{output.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
        <h4>Sources</h4><ul>{output.citations.map((source, i) => <li key={i}>{/^https?:\/\//.test(source) ? <a href={source} target="_blank" rel="noreferrer">{source}</a> : source}</li>)}</ul>
      </details>)}
    </>}
    {history.length > 0 && <details><summary>Model history</summary>{history.map(row => <button className="portfolio-tab" key={row.id} disabled={active} onClick={async () => { const response = await fetch(`/api/agents/sessions/${row.id}`); if (response.ok) setSession(await response.json()); }}>{row.id.slice(0, 8)} · {row.status}</button>)}</details>}
  </section>;
}
