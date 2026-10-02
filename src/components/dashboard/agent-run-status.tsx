'use client';
import type { SessionAction } from '@/lib/agent-finance/l3/session-control';
import type { AgentOutput } from '@/lib/agent-finance/contracts';
import type { RunBriefing } from '@/lib/agent-finance/l3/session-control';

export interface RunEvent {id:string;eventType:string;summary:string;detail?:string|null;occurredAt:string;agent?:string|null;authority:string;consequence:string}
export function AgentRunStatus({status,progress,events=[],liveStatus,briefing,busy,viewer,onControl}:{status:string;progress:number;events?:RunEvent[];liveStatus?:{phase:string;currentAgent:string|null;latestActivity:string|null;updatedAt:string;progress:number}|null;briefing?:RunBriefing;busy:boolean;viewer:boolean;onControl:(action:SessionAction)=>void}) {
  const working=['queued','running'].includes(status);
  return <section className="glass-panel card" aria-label="Research progress and control">
    <h3>Research status: {status.replaceAll('_',' ')}</h3>
    <p className="note">Research can read evidence and calculate scenarios. It cannot trade, change weights or accept conclusions on your behalf.</p>
    {working && <div role="status"><progress value={progress} max={100} aria-label="Research steps finished"/><p>{progress}% of planned steps finished — not a time estimate or guarantee of data quality.</p></div>}
    {!viewer && <div className="workflow-actions">
      {working && <button type="button" className="secondary-button" disabled={busy} onClick={()=>onControl('pause')}>Pause research</button>}
      {status==='awaiting_approval' && <p className="caveat" role="status">Research is waiting for your review. Confirm retained financial inputs below to continue; elapsed time never counts as approval.</p>}
    {status==='paused' && <button type="button" className="action-button" disabled={busy} onClick={()=>onControl('resume')}>Resume research</button>}
      {status==='failed' && <button type="button" className="action-button" disabled={busy} onClick={()=>onControl('retry')}>Retry with retained evidence</button>}
      {['queued','running','paused','awaiting_approval'].includes(status) && <button type="button" className="secondary-button" disabled={busy} onClick={()=>onControl('cancel')}>Cancel research</button>}
    </div>}
    {status==='awaiting_approval' && <p className="caveat" role="status">Research is waiting for your review. Confirm retained financial inputs below to continue; elapsed time never counts as approval.</p>}
    {status==='paused' && <p className="caveat">Completed steps are saved. Already-sent provider requests cannot be revoked, but superseded workers cannot publish results or start another step.</p>}
    {briefing && ['completed','failed','cancelled'].includes(status) && <section className="glass-panel card" aria-label="Return briefing">
      <p className="eyebrow">Research briefing</p><h4>{briefing.outcome}</h4>
      <p className="note">{briefing.completed.length} completed steps · {briefing.gaps.length} steps need attention · {briefing.sourceCount} cited sources{briefing.confidenceScore!==null?` · evidence confidence ${briefing.confidenceScore}/100`:''}</p>
      {briefing.keyFindings.length>0 && <><h5>Key findings</h5><ul>{briefing.keyFindings.map((finding,index)=><li key={`finding-${index}`}>{finding}</li>)}</ul></>}
      {briefing.keyRisks.length>0 && <><h5>Risks and opposing evidence</h5><ul>{briefing.keyRisks.map((risk,index)=><li key={`risk-${index}`}>{risk}</li>)}</ul></>}
      {briefing.gaps.length>0 && <><h5>Steps requiring attention</h5><ul>{briefing.gaps.map(agent=><li key={agent}>{agent.replaceAll('-',' ')}</li>)}</ul></>}
      {briefing.limitations.length>0 && <details><summary>Evidence limitations ({briefing.limitations.length})</summary><ul>{briefing.limitations.map((item,index)=><li key={`limit-${index}`}>{item}</li>)}</ul></details>}
      <h5>Your next action</h5><p>{briefing.nextAction}</p>
      <p className="note">This briefing summarizes validated outputs; it is not private chain-of-thought, an investment guarantee, or authorization to trade or alter portfolio weights.</p>
    </section>}
    {['queued','running','paused','awaiting_approval'].includes(status) && <div className="glass-panel card" aria-label="Current research step"><h4>Current step</h4><p>{liveStatus?.currentAgent ? `${liveStatus.currentAgent} · ${liveStatus.phase}` : `Preparing ${liveStatus?.phase ?? 'research'}`}</p><p className="note">{liveStatus?.latestActivity ?? events.at(-1)?.summary ?? 'The worker has not recorded its first update yet.'}</p>{liveStatus?.updatedAt && <p className="note">Last recorded activity: {new Date(liveStatus.updatedAt).toLocaleString()}</p>}<details><summary>Recent research activity</summary>{events.length ? <ol>{events.slice(-6).map(event => <li key={event.id}><strong>{event.summary}</strong><p className="note">{event.consequence}</p></li>)}</ol> : <p className="note">The queued worker has not recorded an event yet.</p>}</details></div>}
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
