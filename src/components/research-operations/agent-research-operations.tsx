'use client';

import { useEffect, useState } from 'react';
import { AgentActivityInspectorPanel } from '@/components/dashboard/agent-activity-inspector';
import type { AgentActivityInspector } from '@/lib/agent-finance/activity-inspector';
import type { RunEvent } from '@/components/dashboard/agent-run-status';

interface SessionSummary {
  id:string;ownerName:string|null;ticker:string;analysisType:string;status:string;phase:string;createdAt:string;updatedAt:string;completedAt:string|null;error:string|null;
}
interface SessionDetail {status:string;inspector:AgentActivityInspector;events:RunEvent[]}

export default function AgentResearchOperations() {
  const [sessions,setSessions]=useState<SessionSummary[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [detail,setDetail]=useState<SessionDetail|null>(null);
  const [indexError,setIndexError]=useState('');
  const [detailError,setDetailError]=useState('');
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function refreshIndex() {
      try {
        const response=await fetch('/api/agents/sessions?operations=true',{signal:controller.signal,cache:'no-store'});
        const body=await response.json() as {sessions?:SessionSummary[];error?:string};
        if(!response.ok)throw new Error(body.error??'Agent activity could not be loaded.');
        const rows=body.sessions??[];setSessions(rows);setSelectedId(current=>rows.some(row=>row.id===current)?current:rows[0]?.id??'');setIndexError('');
      } catch(cause) {
        if(!controller.signal.aborted)setIndexError(cause instanceof Error?cause.message:'Agent activity could not be loaded.');
      } finally {if(!controller.signal.aborted)setLoading(false);}
      if(!controller.signal.aborted)timer=setTimeout(()=>void refreshIndex(),15000);
    }
    void refreshIndex();
    return()=>{controller.abort();clearTimeout(timer);};
  },[]);

  const selected=sessions.find(row=>row.id===selectedId);
  useEffect(()=>{
    if(!selectedId){setDetail(null);setDetailError('');return;}
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function refreshDetail() {
      try {
        const response=await fetch(`/api/agents/sessions/${selectedId}?view=operations`,{signal:controller.signal,cache:'no-store'});
        const body=await response.json() as SessionDetail&{error?:string};
        if(!response.ok)throw new Error(body.error??'Agent trace could not be loaded.');
        if(!controller.signal.aborted){setDetail(body);setDetailError('');}
        if(['queued','running'].includes(body.status) && !controller.signal.aborted)timer=setTimeout(()=>void refreshDetail(),2500);
      } catch(cause) {
        if(!controller.signal.aborted)setDetailError(cause instanceof Error?cause.message:'Agent trace could not be loaded.');
        if(!controller.signal.aborted)timer=setTimeout(()=>void refreshDetail(),5000);
      }
    }
    setDetail(null);void refreshDetail();
    return()=>{controller.abort();clearTimeout(timer);};
  },[selectedId,selected?.status]);

  return <section className="card glass-panel" aria-label="Agent research operations">
    <div className="card-heading"><div><p className="eyebrow">Agent operations</p><h2>Research session traces</h2></div><span className="stat-chip">Platform admin</span></div>
    <p className="note">Platform administrators can inspect runs across accounts. Prompts, raw request payloads, frozen evidence/configuration snapshots, credentials and private chain-of-thought remain excluded.</p>
    {(indexError||detailError)&&<p role="alert" className="error-text">{indexError||detailError} Saved activity remains visible; automatic refresh will retry.</p>}
    {loading?<p className="note">Loading research sessions…</p>:sessions.length===0?<p className="note">No agent research sessions are recorded for this account yet.</p>:<>
      <div className="form-grid" aria-label="Choose a research session">{sessions.map(row=><button key={row.id} type="button" className={`portfolio-tab${selectedId===row.id?' active':''}`} aria-pressed={selectedId===row.id} onClick={()=>setSelectedId(row.id)}>
        {row.ownerName?`${row.ownerName} · `:''}{row.ticker} · {row.analysisType.replaceAll('_',' ')} · {row.status.replaceAll('_',' ')} · {new Date(row.createdAt).toLocaleDateString()}
      </button>)}</div>
      {selected&&<p className="note">Selected {selected.ticker} · phase {selected.phase.replaceAll('_',' ')} · updated {new Date(selected.updatedAt).toLocaleString()}{selected.error?` · ${selected.error}`:''}</p>}
      {detail?<AgentActivityInspectorPanel inspector={detail.inspector} events={detail.events}/>:<p className="note">Loading the selected run’s detailed trace…</p>}
    </>}
  </section>;
}
