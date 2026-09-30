'use client';
import { useEffect, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AgentOutput, AnalyzeRequest } from '@/lib/agent-finance/contracts';

interface Session {
  id: string; status: string; phase: string; progress: number; error?: string | null;
  agentsCompleted?: string[]; agentsPending?: string[];
  finalOutput?: { outputs: Record<string, AgentOutput>; confidenceScore: number; limitations: string[] } | null;
}
const screens: Record<string, string> = { research: 'loading_research_phase.html', analysis: 'loading_financial_analysis.html', valuation: 'loading_valuation_phase.html' };

export function AgentAnalysis({ ticker, securityId, viewer }: { ticker: string; securityId: string; viewer: boolean }) {
  const [type, setType] = useState<AnalyzeRequest['analysisType']>('combined');
  const [session, setSession] = useState<Session | null>(null);
  const [history, setHistory] = useState<Session[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [frameFailed, setFrameFailed] = useState(false);
  const [growth, setGrowth] = useState(''); const [wacc, setWacc] = useState(''); const [terminal, setTerminal] = useState('');
  const active = session?.status === 'queued' || session?.status === 'running';
  const sessionId = session?.id;
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/agents/sessions?securityId=${encodeURIComponent(securityId)}`).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Unable to load history');
      if (!cancelled) { setHistory(body.sessions); if (body.sessions[0]) setSession(body.sessions[0]); }
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
  async function start() {
    setBusy(true); setError('');
    try {
      const body: AnalyzeRequest = { ticker, analysisType: type };
      if (growth || wacc || terminal) body.userOverrides = { discountRate: wacc ? Number(wacc) / 100 : undefined,
        assumptions: { annualGrowthRate: growth ? Number(growth) / 100 : undefined, terminalGrowthRate: terminal ? Number(terminal) / 100 : undefined } };
      const response = await fetch('/api/agents/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Unable to start');
      setSession({ id: result.sessionId, status: result.status, phase: 'research', progress: 0 });
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to start'); } finally { setBusy(false); }
  }
  const outputs = session?.finalOutput?.outputs;
  const sensitivity = outputs?.['sensitivity-analyst']?.data.scenarios as Array<{ scenario: string; fairValuePerShare: number }> | undefined;
  return <section className="card glow-card">
    <h2>Agent Analysis</h2>
    <p className="note">Research Director · DCF Swarm · Analysis Swarm. Evidence-backed research, never automatic trading.</p>
    {!viewer && <div className="form-grid">
      <label>Analysis type<select value={type} onChange={e => setType(e.target.value as AnalyzeRequest['analysisType'])}><option value="combined">Combined research</option><option value="dcf">DCF valuation</option><option value="fundamental">Financial analysis</option><option value="quick">Quick analysis (no debate)</option></select></label>
      <label>Reviewed FCFF growth (%)<input type="number" min="-50" max="50" step=".1" value={growth} onChange={e => setGrowth(e.target.value)} placeholder="Required for DCF" /></label>
      <label>Reviewed WACC (%)<input type="number" min=".1" max="50" step=".1" value={wacc} onChange={e => setWacc(e.target.value)} placeholder="Required for DCF" /></label>
      <label>Terminal growth (%)<input type="number" min="-5" max="5" step=".1" value={terminal} onChange={e => setTerminal(e.target.value)} placeholder="Required for DCF" /></label>
      <button className="action-button" disabled={busy || active} onClick={() => void start()}>{busy ? 'Starting…' : 'Start analysis'}</button>
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
