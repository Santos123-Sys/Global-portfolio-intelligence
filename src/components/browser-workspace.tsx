'use client';
import {useEffect,useRef,useState} from 'react';
import type {Candidate} from '@/lib/foundation/contracts';
import {canvasPoint,terminal,type BrowserEvent,type BrowserRun,type Observation,type Action} from '@/lib/browser/contracts';

type View=Omit<BrowserRun,'owner'|'actor'|'authSession'|'accountId'|'worker'>;
async function request(url:string,body?:unknown){
  const r=await fetch(url,{cache:'no-store',...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
  const data=await r.json();if(!r.ok)throw Error(data.error??'Browser connection unavailable');return data;
}
export function BrowserWorkspace({candidate}:{candidate:Candidate}) {
  const [config,setConfig]=useState<{enabled:boolean;origins:string[];canEdit:boolean}>({enabled:false,origins:[],canEdit:false});
  const [source,setSource]=useState(''),[year,setYear]=useState(2025),[question,setQuestion]=useState('What primary-source evidence supports the company’s growth and risks?');
  const [run,setRun]=useState<View|null>(null),[events,setEvents]=useState<BrowserEvent[]>([]),[message,setMessage]=useState('');
  const [connected,setConnected]=useState(false),[busy,setBusy]=useState(false),[canControl,setCanControl]=useState(false);
  const [displayPaused,setDisplayPaused]=useState(false),[replay,setReplay]=useState<Observation|null>(null),[shown,setShown]=useState<Observation|null>(null);
  const [confirmed,setConfirmed]=useState(false),[now,setNow]=useState(0);
  const canvas=useRef<HTMLCanvasElement>(null),imageGeneration=useRef(0),cursor=useRef(0),creating=useRef<string|null>(null);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{let active=true;void request('/api/browser-sessions').then(d=>{if(!active)return;setConfig(d);const previous=d.runs?.find((r:View)=>r.input.company===candidate.key);if(previous){setRun(previous);setSource(previous.input.sourceUrl);setYear(previous.input.year);setQuestion(previous.input.question);}}).catch(()=>{});return()=>{active=false;};},[candidate.key]);
  useEffect(()=>{
    if(!run?.id)return;let active=true;let timer:ReturnType<typeof setTimeout>;let stream:EventSource;const id=run.id;
    function connect(){
      stream=new EventSource(`/api/browser-sessions/stream?id=${id}&after=${cursor.current}`);
      stream.onmessage=event=>{try{const d=JSON.parse(event.data);if(!active)return;
        setRun(d.run);setCanControl(d.canControl);setConnected(true);setNow(Date.now());
        const fresh=d.events.filter((e:BrowserEvent)=>e.seq>cursor.current);
        if(fresh.length){cursor.current=fresh[fresh.length-1].seq;setEvents(old=>[...old,...fresh].slice(-200));}
      }catch{setConnected(false);}};
      stream.addEventListener('revoked',()=>{stream.close();setConnected(false);setShown(null);setRun(null);setMessage('Session access revoked.');});
      stream.onerror=()=>{stream.close();if(active){setConnected(false);timer=setTimeout(connect,1500);}};
    }
    connect();return()=>{active=false;clearTimeout(timer);stream.close();};
  },[run?.id]);
  useEffect(()=>{if(replay)setShown(replay);else if(!displayPaused&&run?.observation)setShown(run.frame?.observationId===run.observation.id?{...run.observation,...run.frame,id:run.observation.id}:run.observation);},[run?.observation,run?.frame,displayPaused,replay]);
  useEffect(()=>{
    if(!shown)return;let active=true;const generation=++imageGeneration.current;const img=new Image();
    img.onload=()=>{if(!active||generation!==imageGeneration.current||!canvas.current)return;const ctx=canvas.current.getContext('2d');ctx?.clearRect(0,0,1200,800);ctx?.drawImage(img,0,0,1200,800);};
    img.src='data:image/jpeg;base64,'+shown.image;
    return()=>{active=false;img.onload=null;};
  },[shown]);
  async function start(){
    setBusy(true);setMessage('');creating.current??=crypto.randomUUID();
    try{const d=await request('/api/browser-sessions',{company:candidate.key,year,question,sourceUrl:source,mode:'model',idempotencyKey:creating.current});cursor.current=0;setEvents([]);setReplay(null);setRun(d.run);creating.current=null;}
    catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  async function command(kind:string,action?:Action){
    if(!run)return;setBusy(true);setMessage('');
    try{const d=await request('/api/browser-sessions?id='+run.id,{id:crypto.randomUUID(),epoch:run.epoch,kind,...(action?{action,observationId:shown?.id}:{})});setRun(d.run);}
    catch(e){setMessage((e as Error).message+' Reconnect reads current state; uncertain input is not replayed.');}finally{setBusy(false);}
  }
  const control=canControl&&run?.state==='human'&&connected&&!busy&&!displayPaused&&!replay&&shown?.id===run?.observation?.id;
  if(!config.enabled)return null;
  return <section className="card" aria-label="Live browser research">
    <h3>Browser research · {candidate.name}</h3>
    <p>Public-source reader. One operator, no private sign-in, forms, downloads or purchases. Financial verification remains in FilingLens.</p>
    <label>Reporting year<input type="number" min="2000" max="2200" value={year} onChange={e=>setYear(Number(e.target.value))}/></label>
    <label>Research question<textarea value={question} maxLength={1000} onChange={e=>setQuestion(e.target.value)}/></label>
    <label>Public source URL<input type="url" value={source} onChange={e=>{setSource(e.target.value);creating.current=null;}} placeholder={config.origins[0]??'No source origins configured'}/></label>
    <p className="muted">Allowed origins: {config.origins.join(', ')||'None configured'}. Limits: 30 actions, 20 model calls, 5 minutes active research; session closes after 10 minutes. Observations retained for 7 days.</p>
    <button disabled={busy||!config.canEdit||!candidate.issuer||!config.origins.length} onClick={()=>void start()}>Start browser research</button>
    {message&&<p role="alert">{message}</p>}
    {run&&<>
      <p role="status">{run.input.mode==='fixture'?'Deterministic fixture operator':'GPI research operator · AI DOM researcher'} · {run.state} · {connected?'Connected':'Reconnecting; input disabled'} · {run.reason??''}</p>
      <p>Run scope: {run.issuerId} · {run.input.year} · {run.input.question}</p>
      <div className="actions">
        {(['pause','takeover','resume','stop'] as const).map(kind=><button key={kind} className="secondary" disabled={!canControl||busy||!connected||['completed','cancelled','failed','partial','expired','reconciling'].includes(run.state)} onClick={()=>void command(kind)}>{{pause:'Pause agent',takeover:'Take control',resume:'Resume agent',stop:'Stop task'}[kind]}</button>)}
        <button className="secondary" onClick={()=>setDisplayPaused(v=>!v)}>{displayPaused?'Resume display':'Pause display'}</button>
        <button className="secondary" onClick={()=>setReplay(null)}>Return to live view</button>
      </div>
      <p>{replay?'REPLAY — input disabled':terminal(run.state)?'LAST FRAME — browser task ended':displayPaused?'DISPLAY PAUSED — task may continue':'LIVE — latest browser observation'} · Frame age {shown?Math.max(0,Math.round((now-Date.parse(shown.capturedAt))/1000)):'—'} seconds · {run.actions} actions · {run.calls} decisions · {run.tokens} tokens</p>
      <canvas ref={canvas} width={1200} height={800} style={{width:'100%',height:'auto',background:'#111',border:'1px solid #667'}} aria-label="Browser page. Use observed links and scroll buttons below for keyboard control."
        onClick={e=>{if(!control||!shown)return;const rect=e.currentTarget.getBoundingClientRect(),p=canvasPoint(e.clientX-rect.left,e.clientY-rect.top,rect.width,rect.height,1200,800);if(p)void command('input',{kind:'point',x:p.x,y:p.y});}}/>
      {shown&&<><p>{shown.title} · Tab {shown.tabId.slice(0,8)} · <a href={shown.url} target="_blank" rel="noreferrer">Source page</a></p>
        <label>Active browser tab<select disabled={!control} value={shown.tabId} onChange={e=>void command('input',{kind:'select_tab',tabId:e.target.value})}>{(shown.tabs??[{id:shown.tabId,title:shown.title}]).map(t=><option value={t.id} key={t.id}>{t.title}</option>)}</select></label>
        <div className="actions"><button disabled={!control} onClick={()=>void command('input',{kind:'scroll',dy:-600})}>Scroll up</button><button disabled={!control} onClick={()=>void command('input',{kind:'scroll',dy:600})}>Scroll down</button></div>
        <details><summary>Observed page text and keyboard navigation</summary><pre style={{whiteSpace:'pre-wrap',maxHeight:240,overflow:'auto'}}>{shown.text}</pre>
          {shown.links.map((l,i)=><span key={i}><button className="secondary" disabled={!control} onClick={()=>void command('input',{kind:'link',index:i})}>{l.text||l.url}</button><button className="secondary" disabled={!control} aria-label={'Open in new research tab: '+(l.text||l.url)} onClick={()=>void command('input',{kind:'open_tab',url:l.url})}>New tab</button></span>)}
        </details></>}
      <h4>Action timeline</h4><ol>{events.map(e=><li key={e.seq}>{e.at} · {e.type} · {e.summary} {e.observationId&&<button className="secondary" onClick={()=>void request(`/api/browser-sessions?id=${run.id}&observation=${e.observationId}`).then(d=>setReplay(d.observation)).catch(()=>setMessage('Observation unavailable'))}>Inspect observation</button>}</li>)}</ol>
      <h4>Source evidence awaiting review</h4><p>Exact quote matching checks capture integrity. Issuer/year labels, source authority and financial meaning still require review.</p>
      <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked the source, issuer {run.issuerId} and reporting year {run.input.year}.</label>
      {run.evidence.map(e=><article key={e.id}><blockquote>{e.text}</blockquote><a href={e.finalUrl} target="_blank" rel="noreferrer">{e.title}</a><p>{e.status} · characters {e.start}–{e.end} · {e.capturedAt}</p>
        <button disabled={!confirmed||!config.canEdit||busy} onClick={()=>{setBusy(true);void request('/api/browser-sessions',{kind:'accept',id:run.id,evidenceId:e.id,issuerId:run.issuerId,year:run.input.year,confirmed:true}).then(()=>setMessage('Reviewed excerpt added to corpus. It is not a verified financial figure.')).catch(err=>setMessage(err.message)).finally(()=>setBusy(false));}}>Accept reviewed excerpt into corpus</button></article>)}
    </>}
  </section>;
}
