import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { accountCanEdit } from '@/lib/account-scope';
import { readBoundedJson } from '@/lib/request-body';
import { loadWorkspace,sql } from '@/lib/foundation/store';
import { StartBrowser,publicRun } from '@/lib/browser/contracts';
import { configuredOrigins,allowedSource } from '@/lib/browser/policy';
import { createRun,readRun,submit } from '@/lib/browser/store';
import { documentMeta,digest } from '@/lib/corpus/documents';
import { saveDocument } from '@/lib/corpus/store';

export const runtime='nodejs';
const headers={'cache-control':'no-store','x-content-type-options':'nosniff'};
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
const enabled=()=>process.env.BROWSER_WORKSPACE_ENABLED==='true';
const Id=z.string().uuid();
export async function GET(req:Request) {
  const s=await authenticateRequest(req);if(!s.ok)return s.response;
  if(!enabled())return reply({enabled:false});
  const url=new URL(req.url),id=url.searchParams.get('id');
  try{
    if(!id){
      const rows=await sql()`SELECT payload FROM gpi_browser_sessions WHERE owner_id=${s.auth.userId} ORDER BY created_at DESC LIMIT 10`;
      return reply({enabled:true,origins:configuredOrigins(),canEdit:accountCanEdit(s.auth.role),runs:rows.map(r=>publicRun({...r.payload,observation:null}))});
    }
    if(!Id.safeParse(id).success)return reply({error:'Invalid session'},400);
    const run=await readRun(s.auth.userId,id);if(!run)return reply({error:'Not found'},404);
    const observationId=url.searchParams.get('observation');
    if(observationId){
      if(!Id.safeParse(observationId).success)return reply({error:'Invalid observation'},400);
      const obs=await sql()`SELECT payload FROM gpi_browser_observations WHERE session_id=${id} AND id=${observationId}`;
      return obs[0]?reply({observation:obs[0].payload}):reply({error:'Not found'},404);
    }
    const after=Number(url.searchParams.get('after')??0);
    if(!Number.isSafeInteger(after)||after<0)return reply({error:'Invalid cursor'},400);
    const events=await sql()`SELECT payload FROM gpi_browser_events WHERE session_id=${id} AND seq>${after} ORDER BY seq LIMIT 200`;
    return reply({run:publicRun(run),events:events.map(e=>e.payload),canControl:accountCanEdit(s.auth.role)&&run.actor===s.auth.actorUserId&&run.authSession===s.auth.sessionId});
  }catch{return reply({error:'Browser workspace unavailable'},503);}
}
const Accept=z.object({kind:z.literal('accept'),id:z.string().uuid(),evidenceId:z.string().uuid(),issuerId:z.string(),year:z.number().int(),confirmed:z.literal(true)}).strict();
export async function POST(req:Request) {
  const s=await authenticateRequest(req);if(!s.ok)return s.response;
  if(!enabled())return reply({error:'Browser workspace disabled'},404);
  try{assertSameOrigin(req);if(!accountCanEdit(s.auth.role))throw Error();}catch{return reply({error:'Forbidden'},403);}
  const body=await readBoundedJson(req,12_000);if(!body.ok)return reply({error:body.error},body.status);
  try {
    const url=new URL(req.url),id=url.searchParams.get('id');
    if(id){Id.parse(id);return reply({run:publicRun(await submit(s.auth,id,body.value))},202);}
    const accept=Accept.safeParse(body.value);
    if(accept.success){
      const a=accept.data,run=await readRun(s.auth.userId,a.id);
      const e=run?.evidence.find(e=>e.id===a.evidenceId);
      if(!run||!e)return reply({error:'Not found'},404);
      if(run.input.mode==='fixture')return reply({error:'Synthetic evidence cannot enter the company corpus'},422);
      if(a.issuerId!==run.issuerId||a.year!==run.input.year||e.sha256!==digest(e.text))return reply({error:'Evidence identity or integrity mismatch'},422);
      const metadata=documentMeta({issuerId:e.issuerId,company:run.companyName,year:e.year,form:'Browser excerpt',name:`browser-${e.id}.txt`,
        sourceUrl:e.finalUrl,provenance:'user_upload',sha256:e.sha256,textSha256:e.sha256,parser:'browser-dom-excerpt-user-reviewed-v1',
        retrievedAt:e.capturedAt,periodEnd:null,bytes:Buffer.byteLength(e.text),browserProvenance:{originalUrl:e.originalUrl,finalUrl:e.finalUrl,observedAt:e.observedAt,
          observationId:e.observationId,actionId:e.actionId,start:e.start,end:e.end,method:e.method,verification:'user_reviewed_excerpt_not_financial_verification'}});
      await saveDocument(s.auth.userId,metadata,Buffer.from(e.text),e.text);
      return reply({documentId:metadata.id,status:'user_reviewed_excerpt_not_financial_verification'});
    }
    const input=StartBrowser.parse(body.value);
    if(input.mode==='fixture')return reply({error:'Fixture runs are restricted to the isolated test harness'},422);
    allowedSource(input.sourceUrl,configuredOrigins());
    const workspace=await loadWorkspace(s.auth.userId),candidate=workspace.candidates.find(c=>c.key===input.company);
    if(!candidate?.issuer)return reply({error:'Map the company CIK/CNPJ first'},422);
    return reply({run:publicRun(await createRun(s.auth,input,`${candidate.issuer.jurisdiction}:${candidate.issuer.registryId}`,candidate.name))},201);
  } catch(e) {
    const code=e instanceof Error?e.message:'';
    if(code==='not_found')return reply({error:'Not found'},404);
    if(['forbidden','creator_session_required','control_owned'].includes(code))return reply({error:'Only the creating signed-in operator may control this session'},403);
    return reply({error:'Request rejected: check source scope, current control state, quota and input.'},409);
  }
}
