import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticateRequest} from '@/lib/api-auth';
import {assertSameOrigin} from '@/lib/auth';
import {accountCanEdit} from '@/lib/account-scope';
import {loadWorkspace} from '@/lib/foundation/store';
import {readBoundedJson} from '@/lib/request-body';
import {resolveIssuer} from '@/lib/integrations/shared-contracts';
import {signHandoff} from '@/lib/integrations/workspace-handoff';
export async function POST(req:Request){
 const s=await authenticateRequest(req);if(!s.ok)return s.response;
 try{assertSameOrigin(req);if(!accountCanEdit(s.auth.role))throw Error();}catch{return NextResponse.json({error:'Forbidden'},{status:403});}
 const raw=await readBoundedJson(req,2000);if(!raw.ok)return NextResponse.json({error:raw.error},{status:raw.status});
 const body=z.object({candidateKey:z.string().max(60),confirmed:z.literal(true)}).strict().safeParse(raw.value);
 if(!body.success)return NextResponse.json({error:'Confirm the issuer mapping before handoff'},{status:422});
 try{const w=await loadWorkspace(s.auth.userId),candidate=w.candidates.find(c=>c.key===body.data.candidateKey);
  if(!candidate)return NextResponse.json({error:'Candidate not found'},{status:404});
  const identity=resolveIssuer(candidate);if(identity.status!=='source_linked')return NextResponse.json({error:'Issuer mapping required'},{status:409});
  const now=Math.floor(Date.now()/1000);
  const ticket=signHandoff({version:'workspace-handoff.v1',workspaceId:s.auth.accountId,reviewerUserId:s.auth.actorUserId,
   issuerId:identity.issuer.issuerId,candidateKey:candidate.key,ticker:candidate.ticker,nonce:randomUUID(),issuedAt:now,expiresAt:now+7200,sessionId:s.auth.sessionId,audience:'filinglens',permissions:['analysis:run','valuation:publish']},process.env.INTEGRATION_SIGNING_SECRET??'');
  const base=new URL(process.env.FILINGLENS_API_URL??'');
  if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error();
  base.hash=new URLSearchParams({integration:ticket}).toString();
  return NextResponse.json({url:base.href,expiresAt:new Date((now+7200)*1000).toISOString()},{headers:{'cache-control':'no-store'}});
 }catch{return NextResponse.json({error:'Handoff unavailable'},{status:503});}
}

