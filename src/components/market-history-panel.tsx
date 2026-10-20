'use client';
import {useState} from 'react';
import useSWR from 'swr';
import type {Candidate} from '@/lib/foundation/contracts';
import type {assessHistory} from '@/lib/market/history-quality';
type Data={enabled:boolean;jobs:{candidate_key:string;symbol:string;status:string;error_code:string|null}[];
 snapshots:{id:string;candidate_key:string;symbol:string;source_hash:string;retrieved_at:string;stale:boolean;quality:ReturnType<typeof assessHistory>}[]};
const pct=(v:number)=>`${(v*100).toFixed(2)}%`;
export function MarketHistoryPanel({candidate}:{candidate?:Candidate}){
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const {data,error,mutate}=useSWR<Data>('/api/integration/v1/market-history',async url=>{
  const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Historical datasets unavailable. Try refreshing.');return r.json();
 },{refreshInterval:10000,shouldRetryOnError:false});
 const snapshot=data?.snapshots.find(s=>s.candidate_key===candidate?.key),job=data?.jobs.find(s=>s.candidate_key===candidate?.key);
 const stale=snapshot?.stale;
 return <section className="evidence"><h3>Five-year market dataset</h3>
 <p>Completed company research queues daily market history automatically. Only datasets that pass the checks can feed the five-year risk calculation.</p>
 {error&&<p role="alert">{error.message}</p>}{message&&<p role="status">{message}</p>}
 {candidate&&<button className="secondary" disabled={busy||!data?.enabled} onClick={async()=>{
  setBusy(true);try{const r=await fetch('/api/integration/v1/market-history',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({candidateKey:candidate.key})});
   const result=await r.json();if(!r.ok)throw Error(result.error);setMessage('Request saved. Existing daily requests are reused; failed reads allow up to three attempts.');await mutate();
  }catch{setMessage('History request failed. Check issuer mapping and provider configuration.');}finally{setBusy(false);}
 }}>Prepare or refresh {candidate.ticker} history</button>}
 {!data?.enabled&&<p>Automatic history preparation is not enabled.</p>}
 <p role="status">{job?`Latest request: ${job.status}${job.error_code?' · Provider or validation failed; retry preparation.':''}`:'No request for this company yet.'}</p>
 {snapshot&&<><p><strong>{stale?'Refresh required':snapshot.quality.status==='ready'?'Quality checks passed':snapshot.quality.status==='short_history'?'Less than five years available':'Quarantined: review required'}</strong> · {snapshot.quality.observations} daily observations · {snapshot.quality.firstDate}–{snapshot.quality.lastDate}</p>
 <p>Retrieved {new Date(snapshot.retrieved_at).toLocaleString()}. {snapshot.quality.missingSessions.length} missing reference sessions. Returns are in the listing’s currency.</p>
 {snapshot.quality.metrics&&<p>Annualized volatility {pct(snapshot.quality.metrics.annualizedVolatility)} · Maximum drawdown {pct(snapshot.quality.metrics.maxDrawdown)} · Daily historical VaR 95% {pct(snapshot.quality.metrics.historicalVar95)}</p>}
 <details><summary>Inspect provenance, checks and limitations</summary><p>{snapshot.quality.methodology}</p><p>Provider: Yahoo Finance (unofficial).</p>
 <p><a href={'/api/integration/v1/market-history?snapshotId='+snapshot.id} target="_blank" rel="noreferrer">Inspect daily prices, returns and source lineage (JSON)</a></p>
 <p className="break">Immutable dataset <code>{snapshot.id}</code></p><ul>{[...snapshot.quality.issues,...snapshot.quality.limitations].map(s=><li key={s}>{s}</li>)}</ul></details></>}
 </section>;
}
