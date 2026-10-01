'use client';
import type { SessionAction } from '@/lib/agent-finance/l3/session-control';
import type { AgentOutput } from '@/lib/agent-finance/contracts';

export interface RunEvent {id:string;eventType:string;summary:string;detail?:string|null;occurredAt:string;agent?:string|null;authority:string;consequence:string}
export interface RunBriefing {completed:string[];gaps:string[];nextAction:string;requiresHumanReview:boolean}

export function AgentRunStatus({status,progress,events=[],briefing,busy,viewer,onControl}:{status:string;progress:number;events?:RunEvent[];briefing?:RunBriefing;busy:boolean;viewer:boolean;onControl:(action:SessionAction)=>void}) {
  const working=['queued','running'].includes(status);
  return <section className="glass-panel card" aria-label="Research progress and control">
    <h3>Research status: {status.replaceAll('_',' ')}</h3>
    <p className="note">Research can read evidence and calculate scenarios. It cannot trade, change weights or accept conclusions on your behalf.</p>
    {working && <div role="status"><progress value={progress} max={100} aria-label="Research steps finished"/><p>{progress}% of planned steps finished — not a time estimate or guarantee of data quality.</p></div>}
    {!viewer && <div className="workflow-actions">
      {working && <button type="button" className="secondary-button" disabled={busy} onClick={()=>onControl('pause')}>Pause research</button>}
      {status==='paused' && <button type="button" className="action-button" disabled={busy} onClick={()=>onControl('resume')}>Resume research</button>}
      {status==='failed' && <button type="button" className="action-button" disabled={busy} onClick={()=>onControl('retry')}>Retry with retained evidence</button>}
      {['queued','running','paused','awaiting_approval'].includes(status) && <button type="button" className="secondary-button" disabled={busy} onClick={()=>onControl('cancel')}>Cancel research</button>}
    </div>}
    {status==='paused' && <p className="caveat">Completed steps are saved. Already-sent provider requests cannot be revoked, but superseded workers cannot publish results or start another step.</p>}
    {briefing && <div aria-label="Return briefing"><h4>Your next action</h4><p>{briefing.nextAction}</p><p className="note">{briefing.completed.length} validated steps · {briefing.gaps.length} steps need attention.</p>{briefing.gaps.length>0 && <ul>{briefing.gaps.map(agent=><li key={agent}>{agent.replaceAll('-',' ')}</li>)}</ul>}</div>}
    <h4>Meaningful activity</h4>
    {!events.length ? <p className="note">Waiting for the first research event.</p> : <ol aria-label="Research activity timeline">{events.slice(-12).map(event=><li key={event.id}><strong>{event.summary}</strong>{event.detail && <p className="note">{event.detail}</p>}<small>{event.authority.replaceAll('_',' ')} · {event.consequence} consequence</small></li>)}</ol>}
    {events.length>12 && <details><summary>Earlier activity ({events.length-12})</summary><ol>{events.slice(0,-12).map(event=><li key={event.id}>{event.summary}</li>)}</ol></details>}
  </section>;
}

export function StatementAnalysisSummary({output}:{output:AgentOutput}) {
  const metrics=Array.isArray(output.data.metrics) ? output.data.metrics.filter(row=>row && typeof row==='object') as Record<string,unknown>[] : [];
  const signals=Array.isArray(output.data.signals) ? output.data.signals.filter(row=>row && typeof row==='object') as Record<string,unknown>[] : [];
  const display=(value:unknown)=>typeof value==='number' && Number.isFinite(value) ? value.toLocaleString(undefined,{maximumFractionDigits:2}) : 'Unavailable';
  return <section className="card glass-panel" aria-label="Earnings quality and statement checks">
    <h3>Earnings quality and financial statement checks</h3>
    <p className="caveat">Data quality: {output.dataQuality?.status.replaceAll('_',' ') ?? 'not assessed'} · {Math.round((output.dataQuality?.completeness ?? 0)*100)}% core-field coverage. Confidence is evidence coverage, not a probability of investment success.</p>
    {metrics.length>0 && <div className="table-scroll"><table><caption>Deterministic period metrics</caption><thead><tr>{['Fiscal period','OCF / net income','ROE','DSO (days)','DIO (days)','DPO (days)','FCF'].map(title=><th key={title} scope="col">{title}</th>)}</tr></thead><tbody>{metrics.map((row,index)=><tr key={String(row.date ?? index)}><th scope="row">{String(row.date ?? 'Unknown')}</th>{['cashConversion','returnOnEquity','dso','dio','dpo','freeCashFlow'].map(field=><td key={field}>{display(row[field])}</td>)}</tr>)}</tbody></table></div>}
    <p className="note">ROE is a decimal ratio; FCF uses the issuer’s native reporting currency. CFO minus CapEx is not automatically unlevered FCFF.</p>
    {signals.length>0 ? <ul>{signals.map((signal,index)=><li key={`${signal.code}:${index}`}><strong>{String(signal.code).replaceAll('_',' ')} · {String(signal.severity)}</strong><p>{String(signal.rationale ?? '')}</p><span className="note">{String(signal.period)} · {String(signal.ruleStatus).replaceAll('_',' ')}</span></li>)}</ul> : <p className="note">No signals reported. Missing coverage is not confirmation that the company has no risk.</p>}
    {output.limitations.length>0 && <details><summary>Financial-data limitations</summary><ul>{output.limitations.map((limitation,index)=><li key={index}>{limitation}</li>)}</ul></details>}
  </section>;
}
