'use client';
import {useEffect,useRef,useState} from 'react';
import useSWR,{useSWRConfig} from 'swr';
import type {Candidate} from '@/lib/foundation/contracts';
import {WorkspaceOverview,acceptedPublication} from '@/lib/workspace/contracts';
import {CorpusLibrary} from './corpus-library';
import {PortfolioHub} from './portfolio-hub';
import {BrowserWorkspace} from './browser-workspace';
async function read(url:string){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Workspace overview unavailable. Refresh or use the individual modules.');const body=WorkspaceOverview.parse(await r.json());if(body.candidateKey!==new URL(url,window.location.origin).searchParams.get('company'))throw Error('Company context mismatch. Refresh the workspace.');return body;}
type AnalysisSession={url:string;expiresAt:string};
function CompanyWorkspace({candidate,onResearch}:{candidate:Candidate;onResearch:(key:string,question:string)=>void}){
 const [step,setStep]=useState('Sources'),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[session,setSession]=useState<AnalysisSession|null>(null);
 const frame=useRef<HTMLIFrameElement>(null),pending=useRef(false),active=useRef(true);
 const {mutate:refreshAll}=useSWRConfig();
 const {data,error,mutate}=useSWR('/api/workspace?company='+encodeURIComponent(candidate.key),read,{shouldRetryOnError:false});
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{
  if(!session)return;
  const origin=new URL(session.url).origin;
  async function receive(event:MessageEvent){
   const notice=acceptedPublication(event,origin,frame.current?.contentWindow,candidate.key);
   if(!notice||pending.current)return;
   pending.current=true;setMessage('Reviewed valuation received. Verifying this account and issuer…');
   try{const r=await fetch('/api/integration/v1/portfolio-feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'import_valuation',candidateKey:candidate.key,valuationVersionId:notice.valuationVersionId})});
    if(!r.ok)throw Error();
    await refreshAll('/api/integration/v1/portfolio-feedback');await mutate();
    if(active.current){setStep('Portfolio');setMessage('Reviewed valuation verified and synchronized. Review holdings before calculating risk.');}
   }catch{if(active.current)setMessage('Valuation synchronization is pending. Use Retry valuation import in Portfolio with the version shown in FilingLens.');}
   finally{pending.current=false;}
  }
  window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
 },[session,candidate.key,mutate,refreshAll]);
 async function analyze(){
  setBusy(true);setMessage('Preparing the confirmed company and workspace…');
  try{const r=await fetch('/api/integration/v1/handoff',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({candidateKey:candidate.key,confirmed})});
   const b=await r.json();if(!r.ok)throw Error(b.error??'Analysis unavailable');
   const u=new URL(b.url);if(!data?.financialOrigin||u.origin!==data.financialOrigin||u.pathname!=='/'||!u.hash||typeof b.expiresAt!=='string')throw Error('Financial module configuration mismatch');
   setSession({url:u.href,expiresAt:b.expiresAt});setMessage('Analysis session opened for this company. Confirm the filing and review the results in the panel below.');
  }catch(e){setMessage(e instanceof Error?e.message:'Analysis unavailable');}finally{setBusy(false);}
 }
 return <>
  <div className="section-head"><div><h3>{candidate.name} · {candidate.ticker}</h3><p className="muted">{data?.issuerId??'CIK/CNPJ mapping required'} · One company context across research, financial analysis and portfolio review.</p></div><button className="secondary" onClick={()=>void mutate()}>Refresh source quality</button></div>
  {error&&<p role="alert">{error.message}</p>}
  {data&&<div className="workspace-summary" aria-label="Evidence and results status">
   <article><strong>Source documents</strong><span>{data.documents.count??'Unknown'} · {data.documents.status==='verified'?'text hashes verified':data.documents.status}</span></article>
   <article><strong>Reviewed valuations</strong><span>{data.valuations.count??'Unknown'} · {data.valuations.status}</span></article>
   <article><strong>Workspace risk runs</strong><span>{data.portfolio.count??'Unknown'} · {data.portfolio.status}</span></article>
  </div>}
  {data&&<p className="muted">Source quality checked {new Date(data.checkedAt).toLocaleString()}. Refresh after importing or replacing documents.</p>}
  {data?.documents.status==='blocked'&&<p role="alert" className="notice">Document integrity failed. These derivatives cannot enter research or analysis. Reimport the original source to investigate.</p>}
  <p className="muted">Original files and hashes are retained separately from validated text. Upload labels remain your assertions. Approved valuation and risk snapshots preserve their own dates and assumptions.</p>
  <nav className="actions workspace-steps" aria-label="Investment workflow">{['Sources','Financial analysis','Portfolio'].map((s,i)=><button key={s} aria-pressed={step===s} className={step===s?'':'secondary'} onClick={()=>setStep(s)}>{i+1}. {s}</button>)}</nav>
  {message&&<p role="status" className="callout">{message}</p>}
  <div hidden={step!=='Sources'}>
   <button className="secondary" onClick={()=>onResearch(candidate.key,'What filing evidence supports or challenges the company’s growth and downside thesis?')}>Research this company</button>
   <BrowserWorkspace key={candidate.key} candidate={candidate}/>
   <CorpusLibrary candidates={[candidate]} onAnalysisReady={url=>{
    const u=new URL(url);if(!data?.financialOrigin||u.origin!==data.financialOrigin||u.pathname!=='/'||!u.hash)throw Error('Financial module configuration mismatch');
    setSession({url:u.href,expiresAt:new Date(Date.now()+10*60*1000).toISOString()});setStep('Financial analysis');setMessage('Selected-year documents sent through the single-use handoff. Confirm the filing inside the financial panel.');
   }}/>

  </div>
  <section hidden={step!=='Financial analysis'} aria-label="Financial analysis workspace">
   <h3>Review financial statements and valuation</h3><p>FilingLens analyzes the filing and computes valuation. Nothing is published until you review the sources, assumptions and company mapping and explicitly approve.</p>
   <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>I verified this company’s CIK/CNPJ before opening financial analysis.</label>
   <button disabled={!confirmed||busy||!data?.issuerId||!data.financialOrigin} onClick={()=>void analyze()}>{busy?'Preparing analysis…':session?'Start a fresh analysis session':'Open financial analysis here'}</button>
   {session&&<><p>Workspace authorization expires {new Date(session.expiresAt).toLocaleString()}. If the panel does not open, <a href={session.url} target="_blank" rel="noreferrer">open this analysis session in a separate tab</a>.</p>
    <iframe ref={frame} title={'FilingLens analysis for '+candidate.ticker} src={session.url} className="financial-module" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups" referrerPolicy="no-referrer"/>
   </>}
  </section>
  <div hidden={step!=='Portfolio'}><PortfolioHub candidates={[candidate]} onResearch={onResearch}/></div>
 </>;
}
export function InvestmentWorkspace({candidates,onResearch,selectedKey,onSelectCompany}:{candidates:Candidate[];onResearch:(key:string,question:string)=>void;selectedKey:string;onSelectCompany:(key:string)=>void}){
 const candidate=candidates.find(c=>c.key===selectedKey)??candidates[0];
 return <section className="card"><h2>Investment workspace</h2><p>Follow one company from source evidence through reviewed valuation to portfolio risk. AI research drafts remain hypotheses until you review them.</p>
  <label>Workspace company<select aria-label="Workspace company" value={candidate?.key??''} onChange={e=>onSelectCompany(e.target.value)}>{candidates.map(c=><option key={c.key} value={c.key}>{c.name} · {c.ticker}</option>)}</select></label>
  {candidate?<CompanyWorkspace key={candidate.key} candidate={candidate} onResearch={onResearch}/>:<p>Add a company to your watchlist to begin.</p>}
 </section>;
}
