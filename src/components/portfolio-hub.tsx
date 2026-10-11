'use client';
import {useState,useEffect} from 'react';
import useSWR from 'swr';
import type {Candidate} from '@/lib/foundation/contracts';
import type {z} from 'zod';
import type {RiskResult} from '@/lib/integrations/portfolio-feedback';
type Analysis=z.infer<typeof RiskResult>;
type Data={runs:{id:string;name:string;analysis:Analysis;sharedAt:string}[];valuations:{candidateKey:string;valuation:{valuationVersionId:string;currency:string;impliedValuePerShare:string;approvedAt:string}}[];providerConfigured:boolean};
async function read(url:string){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Portfolio data unavailable');return r.json();}
const pct=(n:number|null|undefined)=>n==null?'Unknown':(n*100).toFixed(2)+'%';
export function PortfolioHub({candidates,onResearch}:{candidates:Candidate[];onResearch:(candidateKey:string,question:string)=>void}){
 const {data,error,mutate}=useSWR<Data>('/api/integration/v1/portfolio-feedback',read,{shouldRetryOnError:false});
 const [key,setKey]=useState(candidates[0]?.key??''),[confirmed,setConfirmed]=useState(false),[handoff,setHandoff]=useState(''),[csv,setCsv]=useState(''),[name,setName]=useState('My portfolio'),[range,setRange]=useState('1y'),[rf,setRf]=useState('0'),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[version,setVersion]=useState('');
 useEffect(()=>{
  const h=new URLSearchParams(window.location.hash.slice(1));
  if(h.get('valuation')){setVersion(h.get('valuation')!);setKey(h.get('candidate')??'');}
  if(h.has('portfolio'))try{
   const encoded=h.get('portfolio')!;if(encoded.length>5000)throw Error();
   const positions:unknown=JSON.parse(atob(encoded));
   if(!Array.isArray(positions)||!positions.length||positions.length>10||
    positions.some(p=>!p||typeof p.symbol!=='string'||!/^[A-Z0-9.-]{1,15}$/.test(p.symbol)||!Number.isFinite(p.shares)||p.shares<=0||p.shares>1e9))throw Error();
   setCsv(positions.map(p=>p.symbol+','+p.shares).join('\n'));setName('Portfolio Studio holdings');setConsent(false);
   setMessage('Holdings received from Portfolio Studio. Review the symbols and quantities before sharing.');
  }catch{setMessage('Invalid portfolio handoff. Enter the holdings manually.');}
  if(h.has('valuation')||h.has('portfolio'))window.history.replaceState(null,'',window.location.pathname);
 },[]);
 async function post(url:string,body:unknown){setBusy(true);setMessage('');try{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const b=await r.json();if(!r.ok)throw Error(b.error);await mutate();return b;}catch(e){setMessage(e instanceof Error?e.message:'Request failed');return null;}finally{setBusy(false);}}
 async function launch(){const r=await post('/api/integration/v1/handoff',{candidateKey:key,confirmed});if(r)setHandoff(r.url);}
 async function run(){try{const positions=csv.trim().split(/\r?\n/).filter(Boolean).map(row=>{const [symbol,shares]=row.split(',');return {symbol:symbol.trim().toUpperCase(),shares:Number(shares)};});
 await post('/api/integration/v1/portfolio-feedback',{idempotencyKey:crypto.randomUUID(),name,positions,range,riskFreeRate:Number(rf)/100,confirmed:consent});
 }catch{setMessage('Use one SYMBOL,shares row per holding.');}}
 const latest=data?.runs[0]?.analysis;
 return <section className="card"><h2>Portfolio, risk & return</h2><p>FilingLens supplies reviewed valuation. Portfolio Risk Studio calculates allocation diagnostics, historical risk and return contributions. GPI keeps the received snapshots in this account.</p>
 {error&&<p role="alert">{error.message}</p>}{message&&<p role="status">{message}</p>}
 <h3>1. Analyze and review a company</h3><select aria-label="Company for FilingLens" value={key} onChange={e=>{setKey(e.target.value);setConfirmed(false);setHandoff('');}}>{candidates.map(c=><option key={c.key} value={c.key}>{c.name} · {c.key}</option>)}</select>
 <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I confirmed this company’s CIK/CNPJ mapping.</label>
 <button disabled={!confirmed||busy} onClick={()=>void launch()}>Open FilingLens handoff</button>
 {handoff&&<p><a href={handoff} target="_blank" rel="noreferrer">Open FilingLens for this company (two-hour workspace authorization)</a></p>}
 <h3>2. Import the reviewed valuation</h3><input aria-label="Approved valuation version" value={version} onChange={e=>setVersion(e.target.value)} placeholder="flv1_…"/>
 <button disabled={!version||busy} onClick={()=>void post('/api/integration/v1/portfolio-feedback',{action:'import_valuation',candidateKey:key,valuationVersionId:version})}>Import from FilingLens</button>
 <ul>{data?.valuations.map(v=><li key={v.valuation.valuationVersionId}>{v.candidateKey}: {v.valuation.currency} {v.valuation.impliedValuePerShare}/share · reviewed {new Date(v.valuation.approvedAt).toLocaleDateString()}</li>)}</ul>
 <h3>3. Allocate and monitor</h3><input aria-label="Portfolio name" value={name} onChange={e=>setName(e.target.value)}/>
 <textarea aria-label="Portfolio holdings" value={csv} onChange={e=>setCsv(e.target.value)} placeholder={'AAPL,12\nMSFT,8\nNVDA,5'}/>
 <select aria-label="Risk lookback" value={range} onChange={e=>setRange(e.target.value)}><option value="6mo">6 months</option><option value="1y">1 year</option><option value="3y">3 years</option></select>
 <label>Annual risk-free assumption (%) <input type="number" min="-10" max="40" value={rf} onChange={e=>setRf(e.target.value)}/></label>
 <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> Share these holdings with Portfolio Risk Studio and retain the results in this GPI account.</label>
 <button disabled={busy||!consent||!csv||!data?.providerConfigured} onClick={()=>void run()}>{busy?'Working…':'Calculate and save risk feedback'}</button>
 {latest&&<><h3>Latest snapshot · {latest.asOf}</h3><p>Volatility {pct(latest.metrics.volatility)} · VaR 95% {pct(latest.metrics.var95)} · Drawdown {pct(latest.metrics.maxDrawdown)} · Lookback return {pct(latest.returns.lookbackReturn)}</p>
 <div className="table-wrap"><table><thead><tr><th>HOLDING</th><th>WEIGHT</th><th>RISK CONTRIBUTION</th><th>RETURN CONTRIBUTION</th><th>REVIEWED VALUE GAP</th><th>MINIMUM VARIANCE</th></tr></thead><tbody>{latest.holdings.map(h=><tr key={h.symbol}><td>{h.symbol}</td><td>{pct(h.weight)}</td><td>{pct(h.riskContribution)}</td><td>{pct(latest.returns.contributions.find(c=>c.symbol===h.symbol)?.contribution)}</td><td>{pct(latest.valuationDiagnostics.find(v=>v.symbol===h.symbol)?.valueGap)}</td><td>{pct(latest.allocation?.weights.find(w=>w.symbol===h.symbol)?.weight)}</td></tr>)}</tbody></table></div>
 <h3>Portfolio feedback for research</h3><ul>{latest.feedback.map((f,i)=><li key={i}>{f.message}</li>)}</ul>
 <button className="secondary" disabled={!key} onClick={()=>onResearch(key,'Revisit this company’s downside thesis and valuation assumptions in light of my portfolio concentration and historical drawdown alerts. Use issuer filing evidence; portfolio alerts are research prompts, not facts about the issuer.')}>Research the selected company using portfolio feedback</button>
 <ul>{latest.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul><p>{latest.methodology} Value gaps are valuation comparisons, not forecasts. Allocation is a retrospective experiment; no orders are submitted.</p></>}
 <h3>Saved monitoring history</h3><ul>{data?.runs.map(r=><li key={r.id}>{r.name} · {r.analysis.asOf} · volatility {pct(r.analysis.metrics.volatility)} · lookback return {pct(r.analysis.returns.lookbackReturn)}</li>)}</ul>
 <p>USD prices only. CVM valuations remain available for research; BRL allocation requires an FX-capable risk engine. Sector and country exposures stay unknown until sourced classifications are available.</p>
 </section>;
}

