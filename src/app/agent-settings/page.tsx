'use client';
import { useState } from 'react';
import useSWR from 'swr';
import type { RuntimePolicy } from '@portfolio-intelligence/agentic-contract';

interface Version {agentKind:string;configVersion:number;name:string;scope:string;promptAddendum:string;enabledTools:string[];runtimePolicy:RuntimePolicy;configurationHash:string;protectedPolicy:string;active:boolean;rolloutState:string;evaluation:unknown}
interface Config extends Version {layer:string;execution:string;allowedTools:string[];versions:Version[]}
interface Run {id:string;agentName:string;status:string;executionTimeMs:number|null;configurationHash:string|null;outputPayload?:{runtimeMetadata?:{model:string;inputTokens:number|null;outputTokens:number|null;estimatedCost:number|null}}}
interface Trace {id:string;agentName:string;toolName:string;status:string;latencyMs:number;errorCode:string|null}
interface Response {configurations:Config[];immutablePolicy:string;runs:Run[];traces:Trace[];confidenceReviews:Array<{band:string;samples:number;meanConfidence:number|null;meanHumanRating:number|null}>;deterministicEnginePolicies:Array<{engineKind:string;name:string;scope:string;policy:string}>}
const fetcher=async(url:string):Promise<Response>=>{const response=await fetch(url);const body=await response.json();if(!response.ok)throw new Error(typeof body.error==='string' ? body.error : 'Unable to load agent controls');return body;};
const limitLabels={maxOutputTokens:'Maximum output tokens',timeoutMs:'Request timeout (milliseconds)',maxAttempts:'Attempt limit (QA / provider retries)',maxToolCalls:'Maximum logical tool invocations',sourceMaxAgeDays:'Source freshness (days)'};

export default function AgentSettingsPage() {
  const {data,error,mutate,isLoading}=useSWR('/api/agent-configs',fetcher,{revalidateOnFocus:false});
  const [selected,setSelected]=useState('thesis_extraction');
  const [draft,setDraft]=useState<Version|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [tab,setTab]=useState<'agents'|'operations'>('agents');
  const config=data?.configurations.find(c=>c.agentKind===selected),editing=draft ?? config;
  const patch=(value:Partial<Version>)=>{if(editing)setDraft({...editing,...value});};
  async function operation(action:string,version?:number,rollout='production') {
    if(!editing)return;
    if(action==='evaluate' && config?.execution!=='deterministic' && !window.confirm('Run 30 baseline and 30 candidate synthetic cases plus source verification? This uses the configured model and incurs API charges.'))return;
    if((action==='promote'||action==='rollback') && !window.confirm(`Activate version ${version} in ${rollout}? New runs will use this version; current runs are unchanged.`))return;
    setBusy(true);setMessage('');
    try {
      const body=action==='save' ? {action,agentKind:selected,name:editing.name,scope:editing.scope,promptAddendum:editing.promptAddendum,enabledTools:editing.enabledTools,runtimePolicy:editing.runtimePolicy} : {action,agentKind:selected,version,rollout};
      const response=await fetch('/api/agent-configs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json();if(!response.ok)throw new Error(typeof result.error==='string' ? result.error : 'Configuration request failed');
      setMessage(result.message);setDraft(null);await mutate();
    }catch(cause){setMessage(cause instanceof Error ? cause.message : 'Operation failed');}finally{setBusy(false);}
  }
  return <main className="agent-control-center">
    <h1>Agent control center</h1><p className="sub">One registry for legacy agents, Financial Swarms and deterministic engines. Changes follow Draft → Evaluate → Shadow/Canary → Production.</p>
    <section className="card"><h2>Protected system policy</h2><p>{data?.immutablePolicy ?? 'Loading…'}</p><p className="note">Confidence uses an evidence-quality rubric, not a calibrated probability. Legacy APIs retain 0–1 compatibility; financial agents and admin reporting use 0–100.</p></section>
    <div className="candidate-actions"><button onClick={()=>setTab('agents')} aria-pressed={tab==='agents'}>Agents & versions</button><button onClick={()=>setTab('operations')} aria-pressed={tab==='operations'}>Run traces & usage</button><button onClick={()=>void mutate()} disabled={busy}>Refresh</button></div>
    {(message||error) && <p role="status" className="security-message">{message || error.message}</p>}
    {isLoading && <p role="status">Loading agent registry…</p>}
    {tab==='agents' && <>
      <label>Agent<select value={selected} disabled={busy} onChange={e=>{setSelected(e.target.value);setDraft(null);}}>{[...new Set(data?.configurations.map(c=>c.layer))].map(layer=><optgroup label={layer} key={layer}>{data?.configurations.filter(c=>c.layer===layer).map(c=><option key={c.agentKind} value={c.agentKind}>{c.name} · {c.execution}</option>)}</optgroup>)}</select></label>
      {config && editing && <section className="card agent-config-card">
        <h2>{config.name}</h2><p className="note">{config.layer} · {config.execution} · production v{config.configVersion} · hash {config.configurationHash.slice(0,12)}</p>
        {config.execution==='deterministic' && <p>Code-backed engine: prompts and model parameters do not change financial arithmetic. Its tools and configuration are protected and audited.</p>}
        <details className="reasoning-policy"><summary>Protected agent policy</summary><textarea aria-label="Protected agent policy" readOnly value={config.protectedPolicy} rows={12}/></details>
        <div className="setup-form">
          <label>Display name<input value={editing.name} maxLength={120} onChange={e=>patch({name:e.target.value})}/></label>
          <label>Portfolio-specific objective<textarea value={editing.scope} maxLength={2000} disabled={config.execution==='deterministic'} onChange={e=>patch({scope:e.target.value})}/></label>
          <label>Source preferences / output emphasis<textarea value={editing.promptAddendum} maxLength={4000} disabled={config.execution==='deterministic'} onChange={e=>patch({promptAddendum:e.target.value})}/></label>
          {config.execution!=='deterministic' && <fieldset><legend>Model execution policy</legend>
            <label>Model<input value={editing.runtimePolicy.model} onChange={e=>patch({runtimePolicy:{...editing.runtimePolicy,model:e.target.value}})}/></label>
            {config.execution==='model' && <label>Approved fallback model (optional)<input value={editing.runtimePolicy.fallbackModel ?? ''} onChange={e=>patch({runtimePolicy:{...editing.runtimePolicy,fallbackModel:e.target.value || null}})}/></label>}
            <label>Reasoning effort<select value={editing.runtimePolicy.reasoningEffort} onChange={e=>patch({runtimePolicy:{...editing.runtimePolicy,reasoningEffort:e.target.value as RuntimePolicy['reasoningEffort']}})}>{['low','medium','high'].map(e=><option key={e}>{e}</option>)}</select></label>
            {(['maxOutputTokens','timeoutMs','maxAttempts','maxToolCalls','sourceMaxAgeDays'] as const).map(field=><label key={field}>{limitLabels[field]}<input type="number" value={editing.runtimePolicy[field]} onChange={e=>patch({runtimePolicy:{...editing.runtimePolicy,[field]:Number(e.target.value)}})}/></label>)}
          </fieldset>}
          <fieldset><legend>Runtime-authorized tools</legend>{config.allowedTools.map(tool=><label key={tool}><input type="checkbox" checked={editing.enabledTools.includes(tool)} disabled={tool!=='web_search'} onChange={e=>patch({enabledTools:e.target.checked ? [...editing.enabledTools,tool] : editing.enabledTools.filter(t=>t!==tool)})}/>{tool}{tool==='web_search' ? ' (optional; enforced)' : ' (protected)'}</label>)}</fieldset>
          <details><summary>Effective draft configuration</summary><pre>{JSON.stringify({protectedPolicy:config.protectedPolicy,objective:editing.scope,outputEmphasis:editing.promptAddendum,tools:editing.enabledTools,modelPolicy:editing.runtimePolicy},null,2)}</pre></details>
          <button disabled={busy} onClick={()=>void operation('save')}>Save immutable draft</button>
        </div>
        <h3>Versions, evaluation and rollout</h3>
        <p className="note">Canary routes 10% of new swarm sessions consistently by session ID. Shadow runs are isolated from accepted output. Legacy stages support production activation only. Evaluations use synthetic diagnostics, not a full investment-quality certification.</p>
        {config.versions.map(v=><details key={v.configVersion}><summary>v{v.configVersion} · {v.rolloutState} {v.active ? '(active)' : ''}</summary>
          <pre>{JSON.stringify({changesFromProduction:{objective:{before:config.scope,after:v.scope},emphasis:{before:config.promptAddendum,after:v.promptAddendum},tools:{before:config.enabledTools,after:v.enabledTools},model:{before:config.runtimePolicy,after:v.runtimePolicy}},evaluation:v.evaluation},null,2)}</pre>
          <div className="candidate-actions"><button disabled={busy} onClick={()=>setDraft(v)}>Use as draft</button><button disabled={busy||v.active} onClick={()=>void operation('evaluate',v.configVersion)}>Evaluate</button><button disabled={busy} onClick={()=>void operation('promote',v.configVersion)}>Promote to production</button>
          {config.layer==='Analysis Swarm' && config.execution==='model' && <><button disabled={busy} onClick={()=>void operation('promote',v.configVersion,'shadow')}>Activate shadow</button><button disabled={busy} onClick={()=>void operation('promote',v.configVersion,'canary')}>Activate 10% canary</button></>}
          <button disabled={busy||v.rolloutState==='draft'} onClick={()=>void operation('rollback',v.configVersion)}>Rollback to version</button></div>
        </details>)}
      </section>}
    </>}
    {tab==='operations' && <section className="card"><h2>Recent runs & tool invocations</h2><p className="note">Costs remain unknown until provider-specific prices are configured; no fabricated estimates. Usage covers authoring calls, not verification or total invoice cost.</p>
      <h3>Confidence vs human review</h3><p className="note">Latest 500 completed sessions with human feedback. This compares evidence-quality scores with reviewer ratings; it is not return-probability calibration.</p><div className="table-wrap"><table><thead><tr><th>Confidence band</th><th>Reviewed samples</th><th>Mean confidence</th><th>Mean human rating</th></tr></thead><tbody>{data?.confidenceReviews.map(row=><tr key={row.band}><td>{row.band}</td><td>{row.samples}</td><td>{row.meanConfidence?.toFixed(1) ?? 'Unmeasured'}</td><td>{row.meanHumanRating?.toFixed(1) ?? 'Unmeasured'}</td></tr>)}</tbody></table></div>
      <div className="table-wrap"><table><thead><tr><th>Agent</th><th>Status</th><th>Duration</th><th>Model</th><th>Input / output tokens</th><th>Authoring cost estimate</th><th>Config hash</th></tr></thead><tbody>{data?.runs.map(r=><tr key={r.id}><td>{r.agentName}</td><td>{r.status}</td><td>{r.executionTimeMs ?? '—'} ms</td><td>{r.outputPayload?.runtimeMetadata?.model ?? 'Deterministic / unavailable'}</td><td>{r.outputPayload?.runtimeMetadata?.inputTokens ?? '—'} / {r.outputPayload?.runtimeMetadata?.outputTokens ?? '—'}</td><td>{r.outputPayload?.runtimeMetadata?.estimatedCost?.toFixed(6) ?? 'Unknown'}</td><td>{r.configurationHash?.slice(0,12) ?? 'Historical'}</td></tr>)}</tbody></table></div>
      <div className="table-wrap"><table><thead><tr><th>Agent</th><th>Tool</th><th>Status</th><th>Latency</th><th>Failure</th></tr></thead><tbody>{data?.traces.map(t=><tr key={t.id}><td>{t.agentName}</td><td>{t.toolName}</td><td>{t.status}</td><td>{t.latencyMs} ms</td><td>{t.errorCode ?? '—'}</td></tr>)}</tbody></table></div>
    </section>}
    <section className="card engine-policy-section"><h2>Deterministic engine policies</h2><p className="note">Protected DCF, comparable-company and risk methodology remains code-backed, not editable model instructions.</p>{data?.deterministicEnginePolicies.map(policy=><details key={policy.engineKind}><summary>{policy.name}</summary><p>{policy.scope}</p><pre>{policy.policy}</pre></details>)}</section>
  </main>;
}
