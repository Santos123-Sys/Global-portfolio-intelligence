'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { BrowserWorkspace } from './browser-workspace';
import type { Candidate } from '@/lib/foundation/contracts';
const candidate:Candidate={key:'browser-verification',ticker:'TEST',name:'Synthetic browser verification',exchange:'XNAS',market:'us',
  identitySourceUrl:'https://fixture.gpi.invalid/',issuer:{jurisdiction:'us',registryId:'0000000001'}};
type Status={enabled:boolean;runtime?:{phase:string;reason:string|null};checks?:Record<string,boolean>;error?:string};
export function BrowserVerification() {
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;
    const update=async()=>{try{const r=await fetch('/api/browser-verification',{cache:'no-store'});const d=await r.json();
      if(!active)return;if(!r.ok)throw Error(d.error??'Verification unavailable');setStatus(d);setError('');
    }catch(e){if(active)setError((e as Error).message);}};
    void update();const timer=setInterval(()=>void update(),5000);return()=>{active=false;clearInterval(timer);};
  },[]);
  return <main className="shell"><Link href="/">Return to GPI</Link><h1>Verify browser research</h1>
    <p>This check uses your existing GPI sign-in and a synthetic website in real Chromium. It makes no model calls, publishes no financial facts, and cannot add its evidence to the company corpus.</p>
    {error&&<p role="alert">{error}</p>}
    {status&&!status.enabled&&<p role="status">Verification is not enabled. The browser rollout is still gated.</p>}
    {status?.enabled&&<>
      <p role="status">Runtime: {status.runtime?.phase??'unknown'} {status.runtime?.reason??''}</p>
      <ol><li>Start synthetic verification and wait for the paused page to appear.</li>
        <li>Choose Take control. Open Observed page text and keyboard navigation, then choose 2025 Annual report.</li>
        <li>Inspect an observation in the timeline, then return to the live view. Reload this page and confirm the run recovers.</li>
        <li>Choose Resume agent. The deterministic operator captures the exact passage and pauses.</li>
        <li>Choose Stop task and wait for cancelled. Confirm the visible canvas and replay using the confirmation button.</li></ol>
      <table><caption>Checks recorded by the server; display confirmation is a user report.</caption>
        <thead><tr><th>Check</th><th>Result</th></tr></thead><tbody>{Object.entries(status.checks??{}).map(([name,passed])=>
          <tr key={name}><td>{name}</td><td>{passed?'Recorded':'Pending'}</td></tr>)}</tbody></table>
      <BrowserWorkspace candidate={candidate} verification/>
    </>}
  </main>;
}
