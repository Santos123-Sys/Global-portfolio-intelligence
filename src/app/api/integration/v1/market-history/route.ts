import {NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticateRequest} from '@/lib/api-auth';
import {assertSameOrigin} from '@/lib/auth';
import {accountCanEdit} from '@/lib/account-scope';
import {readBoundedJson} from '@/lib/request-body';
import {listHistory,queueHistory,readHistory} from '@/lib/market/history-store';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'cache-control':'no-store'};
export async function GET(req:Request){
 const s=await authenticateRequest(req);if(!s.ok)return s.response;
 const id=new URL(req.url).searchParams.get('snapshotId');
 if(id){try{return NextResponse.json(await readHistory(s.auth.userId,id),{headers});}
  catch{return NextResponse.json({error:'Dataset unavailable for this account or integrity check failed'},{status:404,headers});}}
 try{return NextResponse.json({...await listHistory(s.auth.userId),enabled:process.env.MARKET_HISTORY_ENABLED==='true'},{headers});}
 catch{return NextResponse.json({error:'Market history unavailable'},{status:503,headers});}
}
export async function POST(req:Request){
 const s=await authenticateRequest(req);if(!s.ok)return s.response;
 try{assertSameOrigin(req);if(!accountCanEdit(s.auth.role))throw Error();}catch{return NextResponse.json({error:'Forbidden'},{status:403,headers});}
 const body=await readBoundedJson(req,1000);if(!body.ok)return NextResponse.json({error:body.error},{status:body.status,headers});
 try{const input=z.object({candidateKey:z.string().max(60),refresh:z.boolean().default(false)}).strict().parse(body.value);
  await queueHistory(s.auth.userId,input.candidateKey,input.refresh);return NextResponse.json({status:'queued_or_already_prepared',dailyAttemptLimit:3},{status:202,headers});
 }catch(e){const reason=e instanceof Error?e.message:'';
  return NextResponse.json({error:['history_disabled','issuer_unmapped','candidate_not_found'].includes(reason)?reason:'History request unavailable'},{status:422,headers});}
}
