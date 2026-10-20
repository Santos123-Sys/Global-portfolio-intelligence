'use client';
import {useState,useEffect} from 'react';
import {ValuationEvidence} from './valuation-evidence';
import {MarketHistoryPanel} from './market-history-panel';
import useSWR from 'swr';
import type {Candidate} from '@/lib/foundation/contracts';
import type {z} from 'zod';
import type {RiskResult} from '@/lib/integrations/portfolio-feedback';
type Analysis=z.infer<typeof RiskResult>;
type Data={runs:{id:string;name:string;analysis:Analysis;integrationWarnings?:string[];requestInputs?:{range:string;riskFreeRate:number;baseCurrency:string};sharedAt:string}[];valuations:{candidateKey:string;valuation:{valuationVersionId:string;method:'dcf'|'comps';currency:string;impliedValuePerShare:string;approvedAt:string}}[];providerConfigured:boolean};
async function read(url:string){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Portfolio data unavailable');return r.json();}
const pct=(n:number|null|undefined)=>n==null?'Unknown':(n*100).toFixed(2)+'%';
export function PortfolioHub({candidates,onResearch}:{candidates:Candidate[];onResearch:(candidateKey:string,question:string)=>void}){
 const [baseCurrency,setBaseCurrency]=useState('USD');
 const {data,error,mutate}=useSWR<Data>('/api/integration/v1/portfolio-feedback',read,{shouldRetryOnError:false});
 const [key,setKey]=useState(candidates[0]?.key??''),[confirmed,setConfirmed]=useState(false),[handoff,setHandoff]=useState(''),[csv,setCsv]=useState(''),[name,setName]=useState('My portfolio'),[range,setRange]=useState('1y'),[rf,setRf]=useState('0'),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[version,setVersion]=useState('');
 useEffect(()=>{
  const h=new URLSearchParams(window.location.hash.slice(1));
  if(h.get('valuation')){
   const valuationVersionId=h.get('valuation')??'',candidateKey=h.get('candidate')??'';
   setVersion(valuationVersionId);setKey(candidateKey);
   // Recover automatically if the signed service-to-service delivery was unavailable.
   // The existing authenticated mutation re-verifies account and issuer before saving.
   if(/^flv1_[a-f0-9]{64}$/.test(valuationVersionId)&&/^[A-Z0-9.:-]{1,60}$/.test(candidateKey)){
    void fetch('/api/integration/v1/portfolio-feedback',{method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({action:'import_valuation',candidateKey,valuationVersionId})})
      .then(async response=>{const result=await response.json().catch(()=>({}));
        if(!response.ok)throw Error(result.error||'Valuation synchronization pending');
        setMessage('Reviewed FilingLens valuation synchronized with this GPI workspace.');
        await mutate();})
      .catch(()=>setMessage('Automatic valuation retrieval is pending. Use the import button to retry.'));
   }
  }
  if(h.has('portfolio'))try{
   const encoded=h.get('portfolio')!;if(encoded.length>5000)throw Error();
   const positions:unknown=JSON.parse(atob(encoded));
   if(!Array.isArray(positions)||!positions.length||positions.length>10||
    positions.some(p=>!p||typeof p.symbol!=='string'||!/^[A-Z0-9.-]{1,15}$/.test(p.symbol)||!Number.isFinite(p.shares)||p.shares<=0||p.shares>1e9))throw Error();
   const receivedBase=h.get('baseCurrency')??'USD';if(!['USD','BRL','EUR','CHF','GBP','CAD','AUD','JPY','HKD','CNY','SEK','NOK','DKK','NZD','SGD','INR','MXN','ZAR'].includes(receivedBase))throw Error();
   setBaseCurrency(receivedBase);setCsv(positions.map(p=>p.symbol+','+p.shares).join('\n'));setName('Portfolio Studio holdings');setConsent(false);
   setMessage('Holdings received from Portfolio Studio. Review the symbols and quantities before sharing.');
  }catch{setMessage('Invalid portfolio handoff. Enter the holdings manually.');}
  if(h.has('valuation')||h.has('portfolio'))window.history.replaceState(null,'',window.location.pathname);
 },[mutate]);
 async function post(url:string,body:unknown){setBusy(true);setMessage('');try{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const b=await r.json();if(!r.ok)throw Error(b.error);await mutate();return b;}catch(e){setMessage(e instanceof Error?e.message:'Request failed');return null;}finally{setBusy(false);}}
 async function launch(){const r=await post('/api/integration/v1/handoff',{candidateKey:key,confirmed});if(r)setHandoff(r.url);}
 async function run(){try{const positions=csv.trim().split(/\r?\n/).filter(Boolean).map(row=>{const fields=row.split(',');if(fields.length!==2)throw Error();const [symbol,shares]=fields;return {symbol:symbol.trim().toUpperCase(),shares:Number(shares)};});
 await post('/api/integration/v1/portfolio-feedback',{idempotencyKey:crypto.randomUUID(),name,positions,range,baseCurrency,riskFreeRate:Number(rf)/100,confirmed:consent});
 }catch{setMessage('Use one SYMBOL,shares row per holding.');}}
 const latest=data?.runs[0]?.analysis;
 return <section className="card"><h2>Portfolio, risk & return</h2><p>FilingLens supplies reviewed valuation. Portfolio Risk Studio calculates allocation diagnostics, historical risk and return contributions. GPI keeps the received snapshots in this account.</p>
 {error&&<p role="alert">{error.message}</p>}{message&&<p role="status">{message}</p>}
 <h3>1. Analyze and review a company</h3><select aria-label="Company for FilingLens" value={key} onChange={e=>{setKey(e.target.value);setConfirmed(false);setHandoff('');}}>{candidates.map(c=><option key={c.key} value={c.key}>{c.name} · {c.key}</option>)}</select>
 <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I confirmed this company’s CIK/CNPJ mapping.</label>
 <button disabled={!confirmed||busy} onClick={()=>void launch()}>Open FilingLens handoff</button>
 {handoff&&<p><a href={handoff} target="_blank" rel="noreferrer">Open FilingLens for this company (two-hour workspace authorization)</a></p>}
 <h3>2. Synchronized reviewed valuations</h3><p>FilingLens now notifies GPI after approved publication. Returning from FilingLens also retries automatically when delivery was delayed. Manual import remains available for recovery.</p><input aria-label="Approved valuation version" value={version} onChange={e=>setVersion(e.target.value)} placeholder="flv1_…"/>
 <button disabled={!version||busy} onClick={()=>void post('/api/integration/v1/portfolio-feedback',{action:'import_valuation',candidateKey:key,valuationVersionId:version})}>Retry valuation import</button>
 <ul>{data?.valuations.map(v=><li key={v.valuation.valuationVersionId}>{v.candidateKey}: <ValuationEvidence candidateKey={v.candidateKey} valuation={v.valuation}/> · reviewed {new Date(v.valuation.approvedAt).toLocaleDateString()}</li>)}</ul>
 <MarketHistoryPanel candidate={candidates.find(c=>c.key===key)}/>
 <h3>3. Allocate and monitor</h3><input aria-label="Portfolio name" value={name} onChange={e=>{setName(e.target.value);setConsent(false);}}/>
 <textarea aria-label="Portfolio holdings" value={csv} onChange={e=>{setCsv(e.target.value);setConsent(false);}} placeholder={'AAPL,12\nMSFT,8\nNVDA,5'}/>
 <p>Use market symbols (for example PETR4.SA for B3). Each quote currency is verified with the price provider.</p>
 <label>Portfolio base currency <select aria-label="Portfolio base currency" value={baseCurrency} onChange={e=>{setBaseCurrency(e.target.value);setConsent(false);}}>{['USD','BRL','EUR','CHF','GBP','CAD','AUD','JPY','HKD','CNY','SEK','NOK','DKK','NZD','SGD','INR','MXN','ZAR'].map(c=><option key={c}>{c}</option>)}</select></label>
 <select aria-label="Risk lookback" value={range} onChange={e=>{setRange(e.target.value);setConsent(false);}}><option value="6mo">6 months</option><option value="1y">1 year</option><option value="3y">3 years</option><option value="5y">5 years · prepared datasets required</option></select>
 {range==='5y'&&<p>Prepare fresh five-year datasets for every holding in your company list. Missing, short or quarantined histories stop this calculation.</p>}
 <label>Annual risk-free assumption (%) <input type="number" min="-10" max="40" value={rf} onChange={e=>{setRf(e.target.value);setConsent(false);}}/></label>
 <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> Share these holdings with Portfolio Risk Studio and retain the results in this GPI account.</label>
 <button disabled={busy||!consent||!csv||!data?.providerConfigured} onClick={()=>void run()}>{busy?'Working…':'Calculate and save risk feedback'}</button>
 {latest&&<><p role="status">Saved results are historical and do not recalculate when you edit the inputs. Review and confirm the inputs to save a new calculation.</p><p>{data?.runs[0]?.requestInputs ? `Saved assumptions: ${data.runs[0].requestInputs.range} lookback; ${(data.runs[0].requestInputs.riskFreeRate*100).toFixed(2)}% annual risk-free rate.` : 'This older snapshot has no recorded lookback or risk-free assumption.'}</p><p>Saved holdings: {latest.holdings.map(h=>`${h.symbol}: ${h.shares} shares`).join(', ')}</p><h3>Saved snapshot · {latest.asOf} · {latest.baseCurrency??'USD'}</h3><p>Volatility {pct(latest.metrics.volatility)} · VaR 95% {pct(latest.metrics.var95)} · Drawdown {pct(latest.metrics.maxDrawdown)} · Lookback return {pct(latest.returns.lookbackReturn)}</p>
 {latest.exposures&&<><h3>Sourced exposures</h3><p>Sector coverage {pct(latest.exposures.sectorCoverage)} · Principal-office country coverage {pct(latest.exposures.countryCoverage)}. Country is the issuer’s principal office, not revenue geography. Sector systems remain separate.</p>
 <div className="table-wrap"><table><thead><tr><th>EXPOSURE</th><th>CLASSIFICATION</th><th>WEIGHT</th></tr></thead><tbody>{(['sector','country','currency'] as const).flatMap(field=>latest.exposures![field].map(r=><tr key={field+r.label}><td>{field}</td><td>{r.label}</td><td>{pct(r.weight)}</td></tr>))}</tbody></table></div>
 <ul>{latest.classifications?.map(c=><li key={c.symbol}>{c.symbol}: {c.industry??'Industry unknown'} · {c.country??'Country unknown'} · <a href={c.sourceUrl} target="_blank" rel="noreferrer">{c.classificationSystem} source</a> · retrieved {new Date(c.retrievedAt).toLocaleDateString()}</li>)}</ul></>}
 <h3>Currency conversion</h3><ul>{latest.holdings.map(h=><li key={h.symbol}>{h.symbol}: {h.quoteCurrency??'USD'} {h.localPrice?.toFixed(2)??h.price.toFixed(2)} × {h.fxRate?.toFixed(6)??'1'} = {latest.baseCurrency??'USD'} {h.price.toFixed(2)} · rate date {h.fxDate??latest.asOf}</li>)}</ul>
 <ul>{latest.fxSources?.map(f=><li key={f.from+f.to}><a href={f.sourceUrl} target="_blank" rel="noreferrer">{f.provider}</a>: {f.from} → {f.to} · {f.firstDate}–{f.lastDate} · {f.rows} observations</li>)}</ul>
 <div className="table-wrap"><table><thead><tr><th>HOLDING</th><th>WEIGHT</th><th>RISK CONTRIBUTION</th><th>RETURN CONTRIBUTION</th><th>REVIEWED VALUE GAP</th><th>MINIMUM VARIANCE</th></tr></thead><tbody>{latest.holdings.map(h=><tr key={h.symbol}><td>{h.symbol}</td><td>{pct(h.weight)}</td><td>{pct(h.riskContribution)}</td><td>{pct(latest.returns.contributions.find(c=>c.symbol===h.symbol)?.contribution)}</td><td>{pct(latest.valuationDiagnostics.find(v=>v.symbol===h.symbol)?.valueGap)}</td><td>{pct(latest.allocation?.weights.find(w=>w.symbol===h.symbol)?.weight)}</td></tr>)}</tbody></table></div>
 <h3>Portfolio feedback for research</h3><ul>{latest.feedback.map((f,i)=><li key={i}>{f.message}</li>)}</ul>
 <button className="secondary" disabled={!key} onClick={()=>onResearch(key,'Revisit this company’s downside thesis and valuation assumptions in light of my portfolio concentration and historical drawdown alerts. Use issuer filing evidence; portfolio alerts are research prompts, not facts about the issuer.')}>Research the selected company using portfolio feedback</button>
 <ul aria-label="Integration review required">{data?.runs[0]?.integrationWarnings?.map((w,i)=><li key={i}>{w}</li>)}</ul>
 <ul>{latest.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul><p>{latest.methodology} Value gaps are valuation comparisons, not forecasts. Allocation is a retrospective experiment; no orders are submitted.</p></>}
 <h3>Saved monitoring history</h3><ul>{data?.runs.map(r=><li key={r.id}>{r.name} · {r.analysis.asOf} · volatility {pct(r.analysis.metrics.volatility)} · lookback return {pct(r.analysis.returns.lookbackReturn)}</li>)}</ul>
 <p>Historical FX conversion uses ECB reference rates. Missing or stale conversion rates stop the run. Unavailable issuer classifications remain explicitly unclassified. Add the issuer to your GPI company list to include its verified CIK/CNPJ classification source.</p>
 </section>;
}

