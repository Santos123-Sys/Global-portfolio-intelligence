import { randomBytes,timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { accountCanEdit } from '@/lib/account-scope';
import { readBoundedJson } from '@/lib/request-body';
import { sql,loadWorkspace } from '@/lib/foundation/store';
import { readDocuments } from '@/lib/corpus/store';
import { digest } from '@/lib/corpus/documents';
const headers={'cache-control':'no-store'};
export async function POST(req:Request){
  const body=await readBoundedJson(req,4000);if(!body.ok)return NextResponse.json({error:body.error},{status:body.status});
  const bearer=req.headers.get('authorization');
  if(bearer){
    const secret=process.env.FILINGLENS_CORPUS_TOKEN??'',expected=Buffer.from(`Bearer ${secret}`),actual=Buffer.from(bearer);
    if(secret.length<32||actual.length!==expected.length||!timingSafeEqual(actual,expected))return NextResponse.json({error:'Unauthorized'},{status:401});
    const ticket=z.object({ticket:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(body.value);
    if(!ticket.success)return NextResponse.json({error:'Invalid ticket'},{status:400});
    const rows=await sql()`DELETE FROM gpi_corpus_handoffs WHERE token_hash=${digest(ticket.data.ticket)} AND expires_at>now() RETURNING *`;
    if(!rows[0])return NextResponse.json({error:'Expired or used ticket'},{status:404});
    const row=rows[0],docs=await readDocuments(row.owner_id,row.issuer_id,row.start_year,row.end_year);
    const text=docs.map(d=>`\n[DOCUMENT ${d.metadata.id} ${d.metadata.path} ${d.metadata.provenance}]\n${d.text}\n[/DOCUMENT]\n`).join('\n');
    if(!text.length||text.length>500_000)return NextResponse.json({error:'Select a narrower nonempty year window (500,000 character limit)'},{status:422});
    return NextResponse.json({text,company:docs[0].metadata.company,jurisdiction:row.issuer_id.split(':')[0],documents:docs.map(d=>d.metadata)},{headers});
  }
  const s=await authenticateRequest(req);if(!s.ok)return s.response;
  try{assertSameOrigin(req);if(!accountCanEdit(s.auth.role))throw new Error();}catch{return NextResponse.json({error:'Forbidden'},{status:403});}
  const input=z.object({company:z.string(),startYear:z.number().int().min(2000).max(2200),endYear:z.number().int().min(2000).max(2200)}).strict().safeParse(body.value);
  if(!input.success||input.data.startYear>input.data.endYear)return NextResponse.json({error:'Invalid window'},{status:422});
  try{
    const workspace=await loadWorkspace(s.auth.userId),c=workspace.candidates.find(c=>c.key===input.data.company);
    if(!c?.issuer)return NextResponse.json({error:'Company not mapped'},{status:422});
    const base=new URL(process.env.FILINGLENS_API_URL??'');if(base.protocol!=='https:'||base.username||base.password)throw new Error();
    const ticket=randomBytes(32).toString('hex');
    await sql()`DELETE FROM gpi_corpus_handoffs WHERE expires_at<now() OR owner_id=${s.auth.userId}`;
    await sql()`INSERT INTO gpi_corpus_handoffs(token_hash,owner_id,issuer_id,start_year,end_year) VALUES(${digest(ticket)},${s.auth.userId},${`${c.issuer.jurisdiction}:${c.issuer.registryId}`},${input.data.startYear},${input.data.endYear})`;
    base.hash=`gpi=${ticket}`;return NextResponse.json({url:base.href},{headers});
  }catch{return NextResponse.json({error:'Handoff unavailable'},{status:503});}
}
