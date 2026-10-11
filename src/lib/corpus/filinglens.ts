import { z } from 'zod';
import { readBoundedJson } from '../request-body';
import { digest } from './documents';
export async function corpusRequest(path:'extract'|'acquire'|'presentation',body:unknown):Promise<Response> {
  const base=new URL(process.env.FILINGLENS_API_URL??'');
  const token=process.env.FILINGLENS_CORPUS_TOKEN;
  if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash||!token||token.length<32)throw new Error('corpus_unconfigured');
  return fetch(new URL(`/api/integration/v1/documents/${path}`,base),{method:'POST',redirect:'error',
    headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(path==='acquire'?90_000:path==='extract'?105_000:45_000)});
}
export async function corpusJson(path:'extract'|'acquire',body:unknown) {
  const res=await corpusRequest(path,body);
  if(!res.ok){await res.body?.cancel();throw new Error(`corpus_upstream_${res.status}`);}
  const parsed=await readBoundedJson(new Request('https://response.invalid',{method:'POST',body:res.body,headers:{'content-type':'application/json'},duplex:'half'} as RequestInit),32_000_000);
  if(!parsed.ok)throw new Error('corpus_response_invalid');return parsed.value;
}
export async function extractDocument(bytes:Buffer,name:string) {
  const parsed=z.object({text:z.string().min(100).max(2_000_000),sha256:z.string(),parser:z.string().max(80)}).parse(await corpusJson('extract',{base64:bytes.toString('base64'),name}));
  if(parsed.sha256!==digest(bytes))throw new Error('document_hash_mismatch');return parsed;
}
