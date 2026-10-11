import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Evidence, ResearchBrief } from '../research/contracts';

export const DocumentMeta = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/), issuerId: z.string().regex(/^(us:\d{10}|br:\d{14})$/),
  company: z.string().min(1).max(160), year: z.number().int().min(2000).max(2200),
  form: z.string().regex(/^[A-Za-z0-9 -]{1,50}$/), name: z.string().min(1).max(180),
  sourceUrl: z.string().url().nullable(), provenance: z.enum(['regulator_download','user_upload','issuer_download']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), parser: z.string().max(80), textSha256: z.string().regex(/^[a-f0-9]{64}$/),
  retrievedAt: z.string().datetime(), periodEnd: z.string().nullable(),
  bytes: z.number().int().positive().max(8_000_000), path: z.string().max(400),
}).strict();
export type DocumentMeta = z.infer<typeof DocumentMeta>;
export type CorpusDocument = { metadata: DocumentMeta; text: string };
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function safeName(value: string) { return value.normalize('NFKC').replace(/[^\p{L}\p{N} ._-]/gu, '_').replace(/^\.+/, '').slice(0, 120) || 'document'; }
export function documentMeta(input: Omit<DocumentMeta,'id'|'path'>): DocumentMeta {
  const id = digest([input.issuerId,input.year,input.form,input.sha256].join('|'));
  return DocumentMeta.parse({ ...input, id, name: safeName(input.name),
    path: `${safeName(input.company)}--${input.issuerId.replace(':','-')}/${input.year}/${safeName(input.form)}/${id.slice(0,12)}-${safeName(input.name)}` });
}
const tokens = (s: string):string[] => s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
/** Stable exact spans in the complete named extraction; no invented PDF page numbers. */
export function chunkDocument(doc: CorpusDocument) {
  const result: Evidence[] = [];
  for (let start=0; start<doc.text.length;) {
    let end=Math.min(start+2400,doc.text.length);
    if(end<doc.text.length){const boundary=doc.text.lastIndexOf('\n',end);if(boundary>start+1200)end=boundary;}
    result.push({id:`doc:${doc.metadata.id}:${start}:${end}`, metric:`${doc.metadata.form} narrative`, fiscalYear:doc.metadata.year,
      text:doc.text.slice(start,end), sourceUrl:doc.metadata.sourceUrl ?? `/api/corpus?download=${doc.metadata.id}`,
      sourceKind:doc.metadata.provenance, documentId:doc.metadata.id, locator:`${doc.metadata.path} · characters ${start}–${end} · ${doc.metadata.parser}`});
    if(end===doc.text.length)break; start=end-240;
  }
  return result;
}
/** Lexical TF/IDF over complete documents. Authorization filtering occurs in the store before this call. */
export function retrieveDocuments(docs: CorpusDocument[], issuerId:string, brief:ResearchBrief): Evidence[] {
  const chunks=docs.filter(d=>d.metadata.issuerId===issuerId&&d.metadata.year>=brief.startYear&&d.metadata.year<=brief.endYear).flatMap(chunkDocument);
  const terms=[...new Set(tokens(brief.question))].slice(0,32);
  const sets=chunks.map(c=>tokens(c.text));
  const df=new Map(terms.map(t=>[t,sets.filter(s=>s.includes(t)).length]));
  return chunks.map((c,i)=>({c,score:terms.reduce((n,t)=>{const tf=sets[i].filter(w=>w===t).length;return n+(tf? (1+Math.log(tf))*Math.log(1+chunks.length/(1+(df.get(t)??0))):0);},0)}))
    .filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.c.id.localeCompare(b.c.id)).slice(0,10).map(r=>r.c);
}
