'use client';
import {useState} from 'react';
import useSWR from 'swr';
import type {Candidate} from '@/lib/foundation/contracts';
import type {assessHistory} from '@/lib/market/history-quality';
type Data={enabled:boolean;jobs:{candidate_key:string;symbol:string;status:string;error_code:string|null;as_of?:string;attempts?:number}[];
 snapshots:{id:string;candidate_key:string;symbol:string;source_hash:string;retrieved_at:string;stale:boolean;quality:ReturnType<typeof assessHistory>}[]};
const pct=(v:number)=>`${(v*100).toFixed(2)}%`;
export function MarketHistoryPanel({candidate}:{candidate?:Candidate}){
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const {data,error,mutate}=useSWR<Data>('/api/integration/v1/market-history',async url=>{
  const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Historical datasets unavailable. Try refreshing.');return r.json();
 },{refreshInterval:10000,shouldRetryOnError:false});
 const snapshot=data?.snapshots.find(s=>s.candidate_key===candidate?.key),job=data?.jobs.find(s=>s.candidate_key===candidate?.key);
 const stale=snapshot?.stale,q=snapshot?.quality,r=q?.reconciliation,sensitivity=q?.priceSensitivity;
 const today=new Date().toISOString().slice(0,10),capped=job?.as_of?.slice(0,10)===today&&(job?.attempts??0)>=3;
 return <section className="evidence"><h3>Five-year market dataset</h3>
 <p>Completed company research queues daily market history automatically. Only datasets that pass the checks can feed the five-year risk calculation.</p>
 {error&&<p role="alert">{error.message}</p>}{message&&<p role="status">{message}</p>}
 {candidate&&!candidate.issuer&&<p>A verified CIK/CNPJ mapping is required. Update this company’s issuer mapping in Candidates → Advanced candidate import before preparing history.</p>}
 {candidate&&<button className="secondary" disabled={busy||!data?.enabled||!candidate.issuer||capped||job?.status==='running'||job?.status==='queued'} onClick={async()=>{
  setBusy(true);try{const r=await fetch('/api/integration/v1/market-history',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({candidateKey:candidate.key,refresh:true})});
   const result=await r.json();if(!r.ok)throw Error(result.error);setMessage('Request saved. Refresh is limited to three attempts per company per UTC day. Queued/running requests are reused; prior snapshots remain available.');await mutate();
  }catch{setMessage('History request failed. Check issuer mapping and provider configuration.');}finally{setBusy(false);}
 }}>Prepare or refresh {candidate.ticker} history</button>}
 {capped&&<p>Three-attempt daily limit reached. Retry after the next UTC day; existing snapshots are retained.</p>}
 {!data?.enabled&&<p>Automatic history preparation is not enabled.</p>}
 <p role="status">{job?`Latest request: ${job.status}${job.error_code?' · Provider or validation failed; retry preparation.':''}`:'No request for this company yet.'}</p>
 {snapshot&&<><p><strong>{stale?'Refresh required':snapshot.quality.status==='ready'?'Structural checks passed':snapshot.quality.status==='short_history'?'Less than five years available':'Quarantined: review required'}</strong> · {snapshot.quality.observations} daily observations · {snapshot.quality.firstDate}–{snapshot.quality.lastDate}</p>
 <p>Independent price check: <strong>{snapshot.quality.reconciliation?.status??'not configured'}</strong>. This is separate from completeness and return calculations.</p>
 {!!q?.reconciliations?.length&&<ul>{q.reconciliations.map(v=><li key={v.provider}>{v.provider}: {v.status} · {v.comparedSessions} compared · {v.missingSessions} missing · {v.discrepancies.length} discrepancy flags.</li>)}</ul>}
 {!!q?.secondaryAcquisitionFailures?.length&&<p>Unavailable supporting checks: {q.secondaryAcquisitionFailures.map(f=>`${f.provider} (${f.reason})`).join(', ')}. These feeds did not verify prices.</p>}
 {r?.provider&&<p>{r.provider}: {r.comparedSessions} of {snapshot.quality.observations} sessions compared{r.firstComparedDate&&` · ${r.firstComparedDate}–${r.lastComparedDate}`}. {r.status==='partial'?'The rest of the five-year history remains unverified.':r.status==='disputed'?'Conflicting prices block portfolio use.':''}</p>}
 {r&&r.comparedReturns>0&&<p>{r.agreeingReturns} of {r.comparedReturns} adjacent daily returns agree. {r.conflictingReturns} return conflicts; {r.actionDateConflicts} fall on Yahoo corporate-action dates. An event-date overlap is a clue, not a resolved adjustment.</p>}
 <p>Retrieved {new Date(snapshot.retrieved_at).toLocaleString()}. {snapshot.quality.missingSessions.length} missing reference sessions. Returns are in the listing’s currency.</p>
 {snapshot.quality.metrics&&<p>Annualized volatility {pct(snapshot.quality.metrics.annualizedVolatility)} · Maximum drawdown {pct(snapshot.quality.metrics.maxDrawdown)} · Daily historical VaR 95% {pct(snapshot.quality.metrics.historicalVar95)}</p>}
 <details><summary>Inspect provenance, checks and limitations</summary><p>{snapshot.quality.methodology}</p><p>Provider: Yahoo Finance (unofficial).</p>
 {sensitivity?.primary&&sensitivity.secondary&&<><h4>Provider sensitivity · diagnostic only</h4><p>Identical {sensitivity.comparedReturns} adjacent-session pairs, {sensitivity.firstDate}–{sensitivity.lastDate}. These are separate vendor scenarios, not an approved blend or confidence interval.</p>
 <div className="table-wrap" role="region" aria-label="Provider risk comparison" tabIndex={0}><table><caption>Adjusted-price risk comparison</caption><thead><tr><th scope="col">Source</th><th scope="col">Annualized volatility</th><th scope="col">Daily historical VaR 95%</th></tr></thead><tbody>
 <tr><th scope="row">Yahoo</th><td>{pct(sensitivity.primary.annualizedVolatility)}</td><td>{pct(sensitivity.primary.historicalVar95)}</td></tr>
 <tr><th scope="row">{r?.provider}</th><td>{pct(sensitivity.secondary.annualizedVolatility)}</td><td>{pct(sensitivity.secondary.historicalVar95)}</td></tr></tbody></table></div><p>{sensitivity.limitation}</p></>}
 {!!r?.conflictSamples?.length&&<><h4>First conflicting returns</h4><ul>{r.conflictSamples.map(c=><li key={c.date}>{c.date}: Yahoo {pct(c.primaryReturn)} · {r.provider} {pct(c.secondaryReturn)}{c.corporateActionDate?' · Yahoo corporate action reported':''}</li>)}</ul></>}
 {!!r?.agreementRanges?.length&&<p>{r.agreementRanges.length} agreeing return ranges are recorded in the inspectable JSON. Agreement on returns alone does not clear a normalized-level conflict.</p>}
 <p><a href={'/api/integration/v1/market-history?snapshotId='+snapshot.id} target="_blank" rel="noreferrer">Inspect daily prices, returns and source lineage (JSON)</a></p>
 <p className="break">Immutable dataset <code>{snapshot.id}</code></p><ul>{[...snapshot.quality.issues,...snapshot.quality.limitations].map(s=><li key={s}>{s}</li>)}</ul></details></>}
 </section>;
}
