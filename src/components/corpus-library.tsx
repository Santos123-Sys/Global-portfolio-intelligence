'use client';
import { useState } from 'react';
import type { Candidate } from '@/lib/foundation/contracts';
import type { DocumentMeta } from '@/lib/corpus/documents';
export function CorpusLibrary({candidates}:{candidates:Candidate[]}) {
  const [company,setCompany]=useState(''),[year,setYear]=useState(2025),[form,setForm]=useState('10-K');
  const [docs,setDocs]=useState<DocumentMeta[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[handoff,setHandoff]=useState('');
  async function refresh(key=company){const res=await fetch(`/api/corpus?company=${encodeURIComponent(key)}`);const body=await res.json();if(!res.ok)throw new Error(body.error);setDocs(body.documents);}
  async function upload(files:FileList|null){
    if(!files||!company)return;setBusy(true);setMessage('Importing documents…');let saved=0;
    try{if(files.length>20)throw new Error('Import up to twenty files per batch.');
      for(const file of Array.from(files)){
        if(file.size>8_000_000)throw new Error(`${file.name}: maximum 8 MB per document.`);
        const path=file.webkitRelativePath||file.name;
        const detected=/(?:^|\/)(20\d{2})(?:\/|$)/.exec(path);
        const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
        const res=await fetch('/api/corpus',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({company,year:detected?Number(detected[1]):year,form,name:file.name,base64})});
        const body=await res.json();if(!res.ok)throw new Error(body.error);saved++;
      }setMessage(`${saved} documents imported.`);
    }catch(e){setMessage(`${saved} imported. ${e instanceof Error?e.message:'Import failed.'}`);}finally{await refresh().catch(()=>{});setBusy(false);}
  }
  async function openFilingLens(){setBusy(true);setMessage('');try{const res=await fetch('/api/corpus/handoff',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({company,startYear:year,endYear:year})});const body=await res.json();if(!res.ok)throw new Error(body.error);setHandoff(body.url);}catch(e){setMessage(e instanceof Error?e.message:'Handoff failed');}finally{setBusy(false);}}
  return <section className="card"><h2>Company document library</h2><p>Import a company folder or individual PDF, HTML, CSV and text documents. Year subfolders are recognized; choose the document form for each batch.</p>
    <p className="muted">Files and extracted text are retained in your private GPI library and sent to FilingLens for extraction. Uploaded issuer/year labels are user assertions. Research sends retrieved passages to the configured model.</p>
    <label>Library company<select value={company} onChange={e=>{setCompany(e.target.value);setHandoff('');void refresh(e.target.value).catch(()=>setMessage('Library unavailable'));}}><option value="">Select company</option>{candidates.map(c=><option key={c.key} value={c.key}>{c.name}</option>)}</select></label>
    <div className="form-grid"><label>Document year<input type="number" min={2000} max={2200} value={year} onChange={e=>setYear(Number(e.target.value))}/></label><label>Document form<select value={form} onChange={e=>setForm(e.target.value)}>{['10-K','10-Q','8-K','20-F','6-K','FRE','ITR','DFP','IPE','Earnings release','Other'].map(f=><option key={f}>{f}</option>)}</select></label></div>
    <label>Import files<input type="file" multiple accept=".pdf,.html,.htm,.txt,.csv" disabled={!company||busy} onChange={e=>void upload(e.target.files)}/></label>
    <label>Import company folder<input type="file" multiple {...{webkitdirectory:''}} disabled={!company||busy} onChange={e=>void upload(e.target.files)}/></label>
    <button disabled={!company||busy} onClick={()=>void refresh().catch(()=>setMessage('Library unavailable'))}>Refresh library</button>{' '}
    <button disabled={!docs.length||busy} onClick={()=>void openFilingLens()}>Prepare FilingLens analysis for selected year</button>
    {handoff&&<p><a href={handoff} target="_blank" rel="noreferrer">Open document bundle in FilingLens (single use, ten minutes)</a></p>}
    {message&&<p role="status">{message}</p>}
    <ul>{docs.map(d=><li key={d.id} style={{overflowWrap:'anywhere'}}><a href={`/api/corpus?download=${d.id}`}>{d.path}</a> · {d.provenance} <button disabled={busy} onClick={async()=>{setBusy(true);try{const res=await fetch(`/api/corpus?id=${d.id}`,{method:'DELETE'});if(!res.ok)throw new Error();await refresh();setMessage('Document and derived research snapshots removed.');}catch{setMessage('Deletion failed.');}finally{setBusy(false);}}}>Delete</button></li>)}</ul>
  </section>;
}
