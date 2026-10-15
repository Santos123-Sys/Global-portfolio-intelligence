import { sql } from '../foundation/store';
import { DocumentMeta, verifyDocument, type CorpusDocument } from './documents';

export async function listDocuments(owner:string,issuer:string):Promise<DocumentMeta[]> {
  const rows=await sql()`SELECT metadata FROM gpi_documents WHERE owner_id=${owner} AND issuer_id=${issuer} ORDER BY fiscal_year DESC, id`;
  return rows.map(r=>DocumentMeta.parse(r.metadata));
}
export async function readDocuments(owner:string,issuer:string,start:number,end:number):Promise<CorpusDocument[]> {
  const size=await sql()`SELECT coalesce(sum(octet_length(text_content)),0)::bigint AS bytes FROM gpi_documents WHERE owner_id=${owner} AND issuer_id=${issuer} AND fiscal_year BETWEEN ${start} AND ${end}`;
  if(Number(size[0].bytes)>12_000_000)throw new Error('narrow_document_window');
  const rows=await sql()`SELECT metadata,text_content FROM gpi_documents WHERE owner_id=${owner} AND issuer_id=${issuer} AND fiscal_year BETWEEN ${start} AND ${end} ORDER BY fiscal_year DESC,id`;
  return rows.map(r=>{const metadata=DocumentMeta.parse(r.metadata),text=r.text_content as string;verifyDocument(metadata,text);return {metadata,text};});
}
export async function saveDocument(owner:string,metadata:DocumentMeta,original:Buffer,text:string) {
  verifyDocument(metadata,text,original);
  await sql().begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${owner},1))`;
    const existing=await tx`SELECT id FROM gpi_documents WHERE owner_id=${owner} AND id=${metadata.id}`;
    if(existing.length)return;
    const totals=await tx`SELECT count(*)::int AS n,coalesce(sum(octet_length(original)+octet_length(text_content)),0)::bigint AS bytes FROM gpi_documents WHERE owner_id=${owner}`;
    if(totals[0].n>=120||Number(totals[0].bytes)+original.length+Buffer.byteLength(text)>160_000_000)throw new Error('corpus_quota');
    await tx`INSERT INTO gpi_documents(owner_id,id,issuer_id,fiscal_year,metadata,original,text_content)
      VALUES(${owner},${metadata.id},${metadata.issuerId},${metadata.year},${tx.json(metadata)},${original},${text})`;
  });
}
export async function downloadDocument(owner:string,id:string) {
  const rows=await sql()`SELECT metadata,original FROM gpi_documents WHERE owner_id=${owner} AND id=${id}`;
  if(!rows[0])return null;
  const metadata=DocumentMeta.parse(rows[0].metadata),bytes=Buffer.from(rows[0].original as Uint8Array);
  verifyDocument(metadata,undefined,bytes);return {metadata,bytes};
}
export async function deleteDocument(owner:string,id:string) {
  await sql().begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${owner},1))`;
    await tx`DELETE FROM gpi_documents WHERE owner_id=${owner} AND id=${id}`;
    await tx`UPDATE gpi_foundation_jobs SET output=null WHERE owner_id=${owner} AND output::text LIKE ${'%'+id+'%'}`;
    await tx`DELETE FROM gpi_corpus_handoffs WHERE owner_id=${owner}`;
  });
}
