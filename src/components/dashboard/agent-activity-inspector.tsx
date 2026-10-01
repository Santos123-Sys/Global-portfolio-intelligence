'use client';
import { useEffect, useMemo, useState } from 'react';
import type { AgentActivityInspector, InspectorRun } from '@/lib/agent-finance/activity-inspector';
import type { RunEvent } from './agent-run-status';

type InspectorTab='live'|'evidence'|'artifacts'|'audit';
const tabs:Array<{id:InspectorTab;label:string}>=[{id:'live',label:'Live agents'},{id:'evidence',label:'Evidence'},{id:'artifacts',label:'Artifacts'},{id:'audit',label:'Audit trail'}];
const EMPTY_EVENTS:RunEvent[]=[];
const dateTimeFormatter=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'medium',timeZone:'UTC'});
const label=(value:string)=>value.replaceAll('_',' ').replaceAll('-',' ');
const when=(value:string)=>`${dateTimeFormatter.format(new Date(value))} UTC`;
const elapsed=(run:InspectorRun,now:number)=>{
  const end=run.completedAt ? Date.parse(run.completedAt) : now;const seconds=Math.max(0,Math.floor((end-Date.parse(run.startedAt))/1000));
  if(!now&&!run.completedAt)return 'Starting…';const minutes=Math.floor(seconds/60);return minutes?`${minutes}m ${seconds%60}s`:`${seconds}s`;
};

export function AgentActivityInspectorPanel({inspector,events=EMPTY_EVENTS}:{inspector:AgentActivityInspector;events?:RunEvent[]}) {
  const [tab,setTab]=useState<InspectorTab>('live');const active=inspector.runs.some(run=>run.status==='running');const [now,setNow]=useState(0);
  useEffect(()=>{setNow(Date.now());if(!active||tab!=='live')return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[active,tab]);
  const audit=useMemo(()=>[
    ...events.map(event=>({id:`event:${event.id}`,at:event.occurredAt,kind:event.eventType,agent:event.agent,summary:event.summary,detail:event.detail,status:null as string|null,error:null as string|null})),
    ...inspector.toolActivity.map(trace=>({id:`trace:${trace.id}`,at:trace.occurredAt,kind:'registered tool',agent:trace.agentName,summary:`${label(trace.toolName)} · ${trace.status}`,detail:trace.task,status:trace.status,error:trace.errorCode})),
  ].sort((left,right)=>Date.parse(right.at)-Date.parse(left.at)),[events,inspector.toolActivity]);
  const running=inspector.runs.filter(run=>run.status==='running');
  return <section className="glass-panel card" aria-label="Agent Activity Inspector">
    <div className="card-heading"><div><h3>Agent Activity Inspector</h3><p className="note">Inspect live work, evidence, outputs and the durable audit trail.</p></div><span className="stat-chip">{running.length ? `${running.length} active` : 'No active agent'}</span></div>
    <div className="metric-grid" aria-label="Inspector summary">
      <div className="stat-chip metric-card"><span>Agent steps</span><strong>{inspector.runs.length}</strong></div>
      <div className="stat-chip metric-card"><span>Tool events</span><strong>{inspector.toolActivity.length}</strong></div>
      <div className="stat-chip metric-card"><span>Sources</span><strong>{inspector.evidence.length}</strong></div>
      <div className="stat-chip metric-card"><span>Artifacts</span><strong>{inspector.artifacts.length}</strong></div>
    </div>
    <nav className="workspace-nav dashboard-tabs" aria-label="Agent inspector sections">{tabs.map(item=><button key={item.id} type="button" className={`portfolio-tab ${tab===item.id?'active':''}`} aria-pressed={tab===item.id} onClick={()=>setTab(item.id)}>{item.label}</button>)}</nav>
    {tab==='live' && <LiveAgents runs={inspector.runs} now={now}/>} 
    {tab==='evidence' && <EvidencePanel inspector={inspector}/>} 
    {tab==='artifacts' && <ArtifactsPanel inspector={inspector}/>} 
    {tab==='audit' && <AuditPanel rows={audit}/>} 
    <details><summary>Observability and privacy boundary</summary><p className="note">{inspector.privacyNotice}</p><p className="note">Confidence describes evidence quality. Watching an agent work does not authorize a trade, portfolio change or automatic acceptance.</p></details>
  </section>;
}

function LiveAgents({runs,now}:{runs:InspectorRun[];now:number}) {
  if(!runs.length)return <p className="note">The run is queued. Agent steps will appear after the worker claims it.</p>;
  return <div className="dashboard-card-grid">{[...runs].reverse().map(run=><article className="card glow-card" key={run.id}>
    <div className="card-heading"><h4>{run.label}</h4><span className="stat-chip">{label(run.status)}</span></div>
    <p>{run.task}</p>
    {run.currentToolTask && <p className="caveat">Now: {run.currentToolTask}</p>}
    <dl className="metric-grid">
      <div className="metric-card"><dt>Started</dt><dd>{when(run.startedAt)}</dd></div><div className="metric-card"><dt>Elapsed</dt><dd>{elapsed(run,now)}</dd></div>
      <div className="metric-card"><dt>Current tool</dt><dd>{run.currentTool?label(run.currentTool):run.status==='running'?(run.model&&run.model!=='deterministic'?'Producing governed model output':'Preparing next registered step'):'None'}</dd></div><div className="metric-card"><dt>Retries</dt><dd>{run.retryCount}</dd></div>
      <div className="metric-card"><dt>Runtime</dt><dd>{run.model ?? 'Unavailable'}</dd></div><div className="metric-card"><dt>Reasoning policy</dt><dd>{run.reasoningEffort ?? (run.model==='deterministic'?'Registered calculation':'Unavailable')}</dd></div>
    </dl>
    <p className="note">Configuration {run.configurationHash?.slice(0,12) ?? 'not recorded'}{run.configurationVersion?` · version ${run.configurationVersion}`:''}{run.implementationRevision?` · ${run.implementationRevision}`:''}</p>
    {run.dataQuality && <p className="caveat">Data quality: {label(run.dataQuality.status)} · {Math.round(run.dataQuality.completeness*100)}% core coverage</p>}
  </article>)}</div>;
}

function EvidencePanel({inspector}:{inspector:AgentActivityInspector}) {
  if(!inspector.evidence.length)return <p className="note">Exact source references appear after an agent produces a validated artifact. The Live agents tab still shows which evidence-retrieval tool is active.</p>;
  return <div className="table-scroll"><table><caption>Retained sources read by completed agent steps</caption><thead><tr><th scope="col">Source</th><th scope="col">Provider</th><th scope="col">As of</th><th scope="col">Quality</th><th scope="col">Used by</th></tr></thead><tbody>{inspector.evidence.map(row=><tr key={row.source}><th scope="row" style={{overflowWrap:'anywhere'}}>{/^https?:\/\//.test(row.source)?<a href={row.source} target="_blank" rel="noreferrer">{row.source}</a>:row.source}</th><td>{row.provider}</td><td>{row.asOf ?? 'Not recorded'}</td><td>{label(row.quality)}</td><td>{row.agents.map(label).join(', ')}</td></tr>)}</tbody></table></div>;
}

function ArtifactsPanel({inspector}:{inspector:AgentActivityInspector}) {
  if(!inspector.artifacts.length)return <p className="note">Reviewable findings will appear as agent steps finish validation.</p>;
  return <div>{[...inspector.artifacts].reverse().map(artifact=><details className="card" key={artifact.id}><summary>{label(artifact.agentName)} · {label(artifact.status)} · {artifact.confidenceScore}/100</summary>
    <p className="note">Produced {when(artifact.createdAt)} · {artifact.citations.length} cited sources</p>
    {artifact.dataQuality && <p className="caveat">Data quality: {label(artifact.dataQuality.status)} · {Math.round(artifact.dataQuality.completeness*100)}% core coverage</p>}
    <h4>New findings</h4>{artifact.findings.length?<ul>{artifact.findings.map((finding,index)=><li key={index}>{finding}</li>)}</ul>:<p className="note">No standalone finding was emitted; inspect the public audit summary.</p>}
    <h4>Public audit summary</h4><ol>{artifact.reasoningSummary.map((reason,index)=><li key={index}>{reason}</li>)}</ol>
    <p className="note">Structured fields: {artifact.dataKeys.map(label).join(', ') || 'none'}</p>
    {artifact.limitations.length>0 && <><h4>Limitations</h4><ul>{artifact.limitations.map((limitation,index)=><li key={index}>{limitation}</li>)}</ul></>}
  </details>)}</div>;
}

function AuditPanel({rows}:{rows:Array<{id:string;at:string;kind:string;agent?:string|null;summary:string;detail?:string|null;status:string|null;error:string|null}>}) {
  if(!rows.length)return <p className="note">No durable activity has been recorded yet.</p>;
  return <ol aria-label="Detailed agent audit trail">{rows.map(row=><li key={row.id} style={{contentVisibility:'auto',containIntrinsicSize:'1px 120px'}}><strong>{row.summary}</strong><p className="note">{when(row.at)}{row.agent?` · ${label(row.agent)}`:''} · {label(row.kind)}</p>{row.detail&&<p>{row.detail}</p>}{row.error&&<p className="error-text">Sanitized error: {label(row.error)}</p>}</li>)}</ol>;
}
