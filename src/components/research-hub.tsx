'use client';
import { useState } from 'react';
import type { Candidate } from '@/lib/foundation/contracts';
import { ResearchBrief } from '@/lib/research/contracts';
import type { ResearchRun } from '@/lib/research/contracts';

export function ResearchHub({ candidates, disabled, onLaunch, initial }: {
  candidates: Candidate[]; disabled: boolean; onLaunch: (key: string, brief: ResearchBrief) => Promise<void>;
  initial?:{candidateKey:string;question:string};
}) {
  const [key, setKey] = useState(initial?.candidateKey??'');
  const [question, setQuestion] = useState(initial?.question??'');
  const [startYear, setStartYear] = useState(2024), [endYear, setEndYear] = useState(2025);
  const [language, setLanguage] = useState<'en' | 'pt'>('en');
  const [error, setError] = useState('');
  const [acquireMissing,setAcquireMissing]=useState(true);
  return <form className="card" onSubmit={async event => {
    event.preventDefault(); setError('');
    const brief = ResearchBrief.safeParse({ question, startYear, endYear, language,acquireMissing });
    if (!brief.success || !candidates.some(c => c.key === key)) {
      setError('Select a company, enter a question of at least 20 characters and an ordered year range (maximum eleven years).'); return;
    }
    await onLaunch(key, brief.data);
  }}>
    <h2>Direct Research Hub</h2>
    <p>Know the company and question? Start here without running a screen. Add other companies through the candidate import.</p>
    <label>Research company<select value={key} required onChange={e => setKey(e.target.value)}>
      <option value="">Select company</option>{candidates.map(c => <option key={c.key} value={c.key}>{c.name} · {c.ticker}</option>)}
    </select></label>
    <label>Research question<textarea value={question} minLength={20} maxLength={1600} required
      placeholder="What evidence supports or challenges this company's growth thesis?"
      onChange={e => setQuestion(e.target.value)} /></label>
    <div className="form-grid"><label>First fiscal year<input type="number" required min={2000} max={2200} value={startYear} onChange={e => setStartYear(Number(e.target.value))} /></label>
      <label>Last fiscal year<input type="number" required min={2000} max={2200} value={endYear} onChange={e => setEndYear(Number(e.target.value))} /></label></div>
    <label>Report language<select value={language} onChange={e => setLanguage(e.target.value as 'en' | 'pt')}><option value="en">English</option><option value="pt">Português</option></select></label>
    <label><input type="checkbox" checked={acquireMissing} onChange={e=>setAcquireMissing(e.target.checked)}/> Acquire missing official SEC/CVM sources before research</label>
    <p className="muted">Research combines FilingLens financial records with passages from your company document library. Acquisition is bounded and reports unresolved gaps. With models disabled, this produces an evidence and gap pack.</p>
    {error && <p role="alert">{error}</p>}<button disabled={disabled}>Start focused research</button>
  </form>;
}

export function ResearchManagerReport({ run,jobId }: { run: ResearchRun;jobId?:string }) {
  const [exportState,setExportState]=useState('');
  return <section><h3>Managed research · {run.status}</h3><p>{run.brief.question}</p>
    {jobId&&<><button disabled={exportState==='Generating…'} onClick={async()=>{setExportState('Generating…');try{const res=await fetch(`/api/corpus/presentation?job=${jobId}`,{method:'POST'});if(!res.ok)throw new Error();const url=URL.createObjectURL(await res.blob());const a=document.createElement('a');a.href=url;a.download='GPI-Research.pptx';a.click();URL.revokeObjectURL(url);setExportState('Presentation downloaded.');}catch{setExportState('Presentation unavailable.');}}}>Download cited research slides</button><p role="status">{exportState}</p></>}
    <small>{run.architecture} · {run.promptVersion} · {run.modelCalls} model calls · {run.stopReason}</small>
    {run.plan && <ul>{run.plan.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>}
    {run.findings.map((f, i) => <div className="claim" key={i}><span className="badge">{f.perspective} · {f.kind}</span><p>{f.text}</p><small>Falsifier: {f.falsifier}</small>
      {f.citations.map(c => { const evidence = run.evidence.find(e => e.id === c.evidenceId); return <details key={c.evidenceId}>
        <summary>Evidence record · {evidence?.sourceKind}</summary><blockquote>{c.quote}</blockquote>
        {evidence && <><small>{evidence.locator}</small><a href={evidence.sourceUrl} target="_blank" rel="noreferrer">Original source</a></>}
      </details>; })}</div>)}
    {!run.findings.length && <p>No model finding has passed the complete review path.</p>}
    <h4>Evidence gaps and boundaries</h4><ul>{run.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul>
    <details><summary>Available scoped records ({run.evidence.length})</summary>{run.evidence.map(e => <div key={e.id}>
      <small>{e.metric} · FY {e.fiscalYear} · {e.sourceKind}</small><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{e.text}</pre>
    </div>)}</details><p className="muted">Model review is fallible. Citation matching proves record linkage, not the truth of every interpretation. Human review is required.</p>
  </section>;
}
