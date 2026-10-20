import {NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticateRequest} from '@/lib/api-auth';
import {assertSameOrigin} from '@/lib/auth';
import {accountCanEdit} from '@/lib/account-scope';
import {readBoundedJson} from '@/lib/request-body';
import {listPortfolioFeedback,listValuations,importValuation,runPortfolio} from '@/lib/integrations/portfolio-feedback';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'cache-control':'no-store'};
export async function GET(req:Request){
 const s=await authenticateRequest(req);if(!s.ok)return s.response;
 try{const [runs,valuations]=await Promise.all([listPortfolioFeedback(s.auth.userId,s.auth.accountId),listValuations(s.auth.userId,s.auth.accountId)]);
 return NextResponse.json({runs,valuations,providerConfigured:Boolean(process.env.PORTFOLIO_RISK_API_URL&&process.env.PORTFOLIO_RISK_API_TOKEN)},{headers});
 }catch{return NextResponse.json({error:'Portfolio feedback unavailable'},{status:503,headers});}
}
export async function POST(req:Request){
 const s=await authenticateRequest(req);if(!s.ok)return s.response;
 try{assertSameOrigin(req);if(!accountCanEdit(s.auth.role))throw Error();}catch{return NextResponse.json({error:'Forbidden'},{status:403,headers});}
 const body=await readBoundedJson(req,8000);if(!body.ok)return NextResponse.json({error:body.error},{status:body.status,headers});
 try{
 const imported=z.object({action:z.literal('import_valuation'),candidateKey:z.string().max(60),valuationVersionId:z.string().regex(/^flv1_[a-f0-9]{64}$/)}).strict().safeParse(body.value);
 const result=imported.success?await importValuation(s.auth.userId,s.auth.accountId,imported.data.candidateKey,imported.data.valuationVersionId):await runPortfolio(s.auth.userId,s.auth.accountId,body.value);
 return NextResponse.json(result,{headers});
 }catch(e){const message=e instanceof Error?e.message:'unavailable';
 const historyProblem=message.startsWith('history_');
 return NextResponse.json({error:historyProblem?'Five-year history is missing, stale or has failed quality checks. Prepare fresh history for each holding in your GPI company list.':
 ['idempotency_conflict','feedback_quota_reached','issuer_unmapped','candidate_not_found','identity_mismatch'].includes(message)?message:'Portfolio request failed; check holdings, provider availability and valuation scope'},{status:e instanceof z.ZodError||historyProblem?422:503,headers});}
}

