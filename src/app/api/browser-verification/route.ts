import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { accountCanEdit } from '@/lib/account-scope';
import { readBoundedJson } from '@/lib/request-body';
import { sql } from '@/lib/foundation/store';
import { createRun,event,locked } from '@/lib/browser/store';
import { publicRun,type BrowserRun } from '@/lib/browser/contracts';
import { FIXTURE_ORIGIN,FIXTURE_QUOTE } from '@/lib/browser/engine';
import { verificationEnabled } from '@/lib/browser/access';
import { runtimeStatus } from '@/lib/browser/runtime-store';

export const runtime='nodejs';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const Create=z.object({idempotencyKey:z.string().uuid()}).strict();
const Confirm=z.object({kind:z.literal('confirm_display'),id:z.string().uuid(),observationId:z.string().uuid()}).strict();
export async function GET(req:Request) {
  const s=await authenticateRequest(req);if(!s.ok)return s.response;
  if(!verificationEnabled())return reply({enabled:false});
  try{
    const rows=await sql()`SELECT payload FROM gpi_browser_sessions WHERE owner_id=${s.auth.userId}
      AND payload->>'verification'='true' AND payload->'input'->>'mode'='fixture' ORDER BY created_at DESC LIMIT 5`;
    const run=rows[0]?.payload as BrowserRun|undefined;
    const events=run?await sql()`SELECT payload FROM gpi_browser_events WHERE session_id=${run.id} ORDER BY seq`:[];
    const items=events.map(e=>e.payload);
    return reply({enabled:true,origins:[FIXTURE_ORIGIN],canEdit:accountCanEdit(s.auth.role),runs:rows.map(r=>publicRun({...r.payload,observation:null,frame:null})),
      runtime:await runtimeStatus(),checks:{
        observed:!!run?.observation,controlled:items.some(e=>e.type==='control_acknowledged'&&e.summary==='Exclusive human control granted'),
        resumed:items.some(e=>e.type==='control_acknowledged'&&e.summary==='Agent resumed after fresh observation'),
        captured:!!run?.evidence.some(e=>e.text===FIXTURE_QUOTE),stopped:run?.state==='cancelled',
        displayConfirmedByUser:items.some(e=>e.type==='verification_display_confirmed'),
      }});
  }catch{return reply({error:'Verification status unavailable'},503);}
}
export async function POST(req:Request) {
  const s=await authenticateRequest(req);if(!s.ok)return s.response;
  if(!verificationEnabled())return reply({error:'Browser verification disabled'},404);
  try{assertSameOrigin(req);if(!accountCanEdit(s.auth.role))throw Error();}catch{return reply({error:'Forbidden'},403);}
  const body=await readBoundedJson(req,2000);if(!body.ok)return reply({error:body.error},body.status);
  try{
    const confirmation=Confirm.safeParse(body.value);
    if(confirmation.success){
      const c=confirmation.data;
      await locked(c.id,async(run,tx)=>{
        if(run.owner!==s.auth.userId||run.actor!==s.auth.actorUserId||run.authSession!==s.auth.sessionId||!run.verification)throw Error('not_found');
        const observation=await tx`SELECT 1 FROM gpi_browser_observations WHERE session_id=${run.id} AND id=${c.observationId}`;
        if(!observation.length)throw Error('not_found');
        const receipts=await tx`SELECT payload FROM gpi_browser_events WHERE session_id=${run.id} AND payload->>'type'='control_acknowledged'`;
        if(run.state!=='cancelled'||!run.evidence.some(e=>e.text===FIXTURE_QUOTE)||
          !receipts.some(e=>e.payload.summary==='Exclusive human control granted')||
          !receipts.some(e=>e.payload.summary==='Agent resumed after fresh observation'))throw Error('verification_steps_incomplete');
        const previous=await tx`SELECT 1 FROM gpi_browser_events WHERE session_id=${run.id} AND payload->>'type'='verification_display_confirmed'`;
        if(!previous.length)await event(tx,run,'verification_display_confirmed','Signed-in operator reports visible canvas, replay and reload recovery',{observationId:c.observationId});
      });
      console.log(JSON.stringify({kind:'browser_signed_in_verification',runId:c.id,
        status:'server_checks_passed_user_display_reported',automatedVisualProof:false}));
      return reply({status:'user_report_retained_not_automated_visual_proof'});
    }
    const c=Create.parse(body.value);
    const run=await createRun(s.auth,{company:'browser-verification',year:2025,
      question:'Verify the synthetic report, exclusive control, evidence capture and stop.',
      sourceUrl:FIXTURE_ORIGIN+'/',idempotencyKey:c.idempotencyKey,mode:'fixture'},'us:0000000001','Synthetic browser verification',true);
    return reply({run:publicRun(run)},201);
  }catch(e){
    const code=e instanceof Error?e.message:'';
    if(code==='browser_capacity_unavailable')return reply({error:'Browser runtime is not ready. Verification cannot start yet.'},503);
    if(code==='not_found')return reply({error:'Not found'},404);
    return reply({error:'Verification request rejected; check active tasks, quota and input.'},409);
  }
}
