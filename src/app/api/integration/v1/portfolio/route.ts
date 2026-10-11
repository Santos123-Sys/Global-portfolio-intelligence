import {NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticateRequest} from '@/lib/api-auth';
import {listPortfolioFeedback} from '@/lib/integrations/portfolio-feedback';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'cache-control':'no-store'};
export async function GET(req:Request){
 const s=await authenticateRequest(req);if(!s.ok)return s.response;
 if(process.env.PORTFOLIO_RISK_READ_ENABLED!=='true')return NextResponse.json({status:'disabled'},{headers});
 const url=new URL(req.url),id=url.searchParams.get('portfolioId'),runId=url.searchParams.get('runId');
 if(!z.string().uuid().safeParse(id).success||(runId&&!z.string().uuid().safeParse(runId).success))return NextResponse.json({error:'Invalid portfolio/run reference'},{status:422,headers});
 try{const rows=await listPortfolioFeedback(s.auth.userId,s.auth.accountId),row=rows.find(r=>r.id===id);
 if(!row||runId&&row.analysis.runId!==runId)return NextResponse.json({error:'Portfolio snapshot not found'},{status:404,headers});
 return NextResponse.json({status:'ready',analysis:row.analysis,source:'portfolio-risk-studio',coverage:{sector:'unclassified',country:'unclassified',baseCurrency:'USD'},storedAt:row.sharedAt},{headers});
 }catch{return NextResponse.json({status:'unavailable'},{status:503,headers});}
}
