'use client';
import type { SessionAction } from '@/lib/agent-finance/l3/session-control';
import type { AgentOutput } from '@/lib/agent-finance/contracts';
import type { RunBriefing } from '@/lib/agent-finance/l3/session-control';

export interface RunEvent {id:string;eventType:string;summary:string;detail?:string|null;occurredAt:string;agent?:string|null;authority:string;consequence:string}

function label(value:string|null|undefined, fallback='Not started') {
  return value ? value.replaceAll('-',' ').replaceAll('_',' ') : fallback;
}

export function AgentRunStatus({status,progress,events=[],liveStatus,briefing,busy,viewer,onControl}:{status:string;progress:number;events?:RunEvent[];liveStatus?:{phase:string;currentAgent:string|null;latestActivity:string|null;updatedAt:string;progress:number}|null;briefing?:RunBriefing;busy:boolean;viewer:boolean;onControl:(action:SessionAction)=>void}) {
  const working=['queued','running'].includes(status);
  const active=['queued','running','paused','awaiting_approval'].includes(status);
  const recent=[...events].slice(-6).reverse();
  return <section className="agent-console" aria-label="Research progress and control">
    <header className="agent-console-header">
      <div>
        <p className="analysis-eyebrow">Agentic research execution</p>
        <h3>Research status: {label(status)}</h3>
        <p className="note">Research can collect evidence, calculate scenarios and challenge a thesis. It cannot trade, change weights or accept conclusions on your behalf.</p>
      </div>
      <span className={`agent-status-pill agent-status-${status}`}>{label(status)}</span>
    </header>

    {active && <>
      <div className="agent-console-metrics" aria-label="Current research state">
        <div><span>Phase</span><strong>{label(liveStatus?.phase,'Research')}</strong></div>
        <div><span>Current agent</span><strong>{label(liveStatus?.currentAgent, status==='queued'?'Queued':'Orchestrator')}</strong></div>
        <div><span>Planned work</span><strong>{progress}%</strong></div>
      </div>
      <div className="agent-progress-track" role="status">
        <div className="agent-progress-copy"><span>Validated steps completed</span><span>{progress}%</span></div>
        <progress value={progress} max={100} aria-label="Research steps finished" />
        <p className="note">Progress reflects persisted workflow steps, not elapsed time, model confidence or a guarantee of research quality.</p>
      </div>
    </>}

    {!viewer && <div className="agent-console-controls" aria-label="Research controls">
      {working && <button type="button" className="secondary-button" disabled={busy} onClick={()=>onControl('pause')}>Pause research</button>}
      {status==='paused' && <button type="button" className="action-button" disabled={busy} onClick={()=>onControl('resume')}>Resume research</button>}
      {status==='failed' && <button type="button" className="action-button" disabled={busy} onClick={()=>onControl('retry')}>Retry with retained evidence</button>}
      {active && <button type="button" className="secondary-button" disabled={busy} onClick={()=>onControl('cancel')}>Cancel research</button>}
    </div>}

    {status==='awaiting_approval' && <div className="agent-approval-callout" role="status"><strong>Your review is required.</strong><span> Confirm the retained financial inputs below to continue. Elapsed time never counts as approval.</span></div>}
    {status==='paused' && <div className="agent-approval-callout"><strong>Research paused.</strong><span> Completed steps are preserved. Already-sent provider requests cannot be revoked, but superseded workers cannot publish results or start another step.</span></div>}

    {active && <section className="agent-activity-board" aria-label="Current research step">
      <div className="agent-activity-current">
        <span className="agent-activity-kicker">Current activity</span>
        <strong>{liveStatus?.currentAgent ? `${label(liveStatus.currentAgent)} · ${label(liveStatus.phase)}` : `Preparing ${label(liveStatus?.phase,'research')}`}</strong>
        <p>{liveStatus?.latestActivity ?? events.at(-1)?.summary ?? 'The worker has not recorded its first update yet.'}</p>
        {liveStatus?.updatedAt && <time className="note" dateTime={liveStatus.updatedAt}>Last recorded activity: {new Date(liveStatus.updatedAt).toLocaleString()}</time>}
      </div>
      <div className="agent-event-timeline">
        <div className="agent-event-heading"><span>Recent activity</span><span>{events.length} event{events.length===1?'':'s'}</span></div>
        {recent.length ? <ol>{recent.map(event => <li key={event.id}>
          <span className={`agent-event-dot consequence-${event.consequence}`} aria-hidden="true" />
          <div><strong>{event.summary}</strong><p className="note">{event.agent ? `${label(event.agent)} · ` : ''}{label(event.authority)} · {label(event.consequence)} consequence</p></div>
          <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time>
        </li>)}</ol> : <p className="note">The queued worker has not recorded an event yet.</p>}
      </div>
    </section>}

    {briefing && ['completed','failed','cancelled'].includes(status) && <section className="agent-return-briefing" aria-label="Return briefing">
      <div className="agent-return-heading"><div><p className="analysis-eyebrow">Research briefing</p><h4>{briefing.outcome}</h4></div><div className="agent-return-stat"><span>Evidence confidence</span><strong>{briefing.confidenceScore!==null?`${briefing.confidenceScore}/100`:'Not scored'}</strong></div></div>
      <div className="agent-console-metrics compact"><div><span>Completed</span><strong>{briefing.completed.length}</strong></div><div><span>Needs attention</span><strong>{briefing.gaps.length}</strong></div><div><span>Cited sources</span><strong>{briefing.sourceCount}</strong></div></div>
      {briefing.keyFindings.length>0 && <div className="agent-brief-section"><h5>Key findings</h5><ul>{briefing.keyFindings.map((finding,index)=><li key={`finding-${index}`}>{finding}</li>)}</ul></div>}
      {briefing.keyRisks.length>0 && <div className="agent-brief-section"><h5>Risks and opposing evidence</h5><ul>{briefing.keyRisks.map((risk,index)=><li key={`risk-${index}`}>{risk}</li>)}</ul></div>}
      {briefing.gaps.length>0 && <div className="agent-brief-section"><h5>Steps requiring attention</h5><ul>{briefing.gaps.map(agent=><li key={agent}>{label(agent)}</li>)}</ul></div>}
      {briefing.limitations.length>0 && <details><summary>Evidence limitations ({briefing.limitations.length})</summary><ul>{briefing.limitations.map((item,index)=><li key={`limit-${index}`}>{item}</li>)}</ul></details>}
      <div className="agent-next-action"><span>Next decision</span><strong>{briefing.nextAction}</strong></div>
      <p className="note">This briefing summarizes validated outputs; it is not private chain-of-thought, an investment guarantee, or authorization to trade or alter portfolio weights.</p>
    </section>}
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
