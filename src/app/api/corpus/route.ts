import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { accountCanEdit } from '@/lib/account-scope';
import { readBoundedJson } from '@/lib/request-body';
import { loadWorkspace } from '@/lib/foundation/store';
import { deleteDocument,downloadDocument,listDocuments,saveDocument } from '@/lib/corpus/store';
import { documentMeta,digest } from '@/lib/corpus/documents';
import { extractDocument } from '@/lib/corpus/filinglens';
import { z } from 'zod';
export const runtime='nodejs';
const headers={'cache-control':'no-store'};
export async function GET(req:Request){
  const s=await authenticateRequest(req);if(!s.ok)return s.response;
  const url=new URL(req.url);
  try{
    const id=url.searchParams.get('download');
    if(id){if(!/^[a-f0-9]{64}$/.test(id))return NextResponse.json({error:'Invalid document'},{status:400});
      const doc=await downloadDocument(s.auth.userId,id);if(!doc)return NextResponse.json({error:'Not found'},{status:404});
      return new Response(new Uint8Array(doc.bytes),{headers:{...headers,'content-type':'application/octet-stream','content-disposition':`attachment; filename="${doc.metadata.name.replace(/[^A-Za-z0-9._-]/g,'_')}"`,'x-content-type-options':'nosniff'}});}
    const workspace=await loadWorkspace(s.auth.userId),candidate=workspace.candidates.find(c=>c.key===url.searchParams.get('company'));
    if(!candidate?.issuer)return NextResponse.json({documents:[]},{headers});
    return NextResponse.json({documents:await listDocuments(s.auth.userId,`${candidate.issuer.jurisdiction}:${candidate.issuer.registryId}`)},{headers});
  }catch{return NextResponse.json({error:'Document store unavailable'},{status:503,headers});}
}
const Upload=z.object({company:z.string(),year:z.number().int().min(2000).max(2200),form:z.string().regex(/^[A-Za-z0-9 -]{1,50}$/),name:z.string().max(180),base64:z.string().max(10_666_672).regex(/^[A-Za-z0-9+/]*={0,2}$/)}).strict();
export async function POST(req:Request){
  const s=await authenticateRequest(req);if(!s.ok)return s.response;
  try{assertSameOrigin(req);if(!accountCanEdit(s.auth.role))throw new Error();}catch{return NextResponse.json({error:'Forbidden'},{status:403});}
  const body=await readBoundedJson(req,10_668_000);if(!body.ok)return NextResponse.json({error:body.error},{status:body.status});
  const input=Upload.safeParse(body.value);if(!input.success)return NextResponse.json({error:'Invalid document'},{status:422});
  try{
    const d=input.data,workspace=await loadWorkspace(s.auth.userId),candidate=workspace.candidates.find(c=>c.key===d.company);
    if(!candidate?.issuer)return NextResponse.json({error:'Map the company CIK/CNPJ first'},{status:422});
    const raw=Buffer.from(d.base64,'base64');if(!raw.length||raw.length>8_000_000)return NextResponse.json({error:'Document exceeds 8 MB'},{status:413});
    const extracted=await extractDocument(raw,d.name);
    const metadata=documentMeta({issuerId:`${candidate.issuer.jurisdiction}:${candidate.issuer.registryId}`,company:candidate.name,year:d.year,form:d.form,name:d.name,
      sourceUrl:null,provenance:'user_upload',sha256:digest(raw),parser:extracted.parser,textSha256:digest(extracted.text),retrievedAt:new Date().toISOString(),periodEnd:null,bytes:raw.length});
    await saveDocument(s.auth.userId,metadata,raw,extracted.text);
    return NextResponse.json({document:metadata},{status:201,headers});
  }catch{return NextResponse.json({error:'Import failed: check format, text/OCR, service configuration and storage quota.'},{status:422,headers});}
}
export async function DELETE(req:Request){
  const s=await authenticateRequest(req);if(!s.ok)return s.response;
  try{assertSameOrigin(req);if(!accountCanEdit(s.auth.role))throw new Error();}catch{return NextResponse.json({error:'Forbidden'},{status:403});}
  const id=new URL(req.url).searchParams.get('id');if(!id||!/^[a-f0-9]{64}$/.test(id))return NextResponse.json({error:'Invalid document'},{status:400});
  try{await deleteDocument(s.auth.userId,id);return NextResponse.json({deleted:true},{headers});}catch{return NextResponse.json({error:'Delete unavailable'},{status:503});}
}
