import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { agentAnalysisSessions,agentRuns,agentSessionEvents } from '@/lib/db/agent-schema';
import { financialInputFromFoundation } from '@/lib/agent-finance/l4/financial-statement-analyzer';
import type { Foundation } from '@/lib/agent-finance/l4/foundation';
import { analyzeSchema } from '@/lib/agent-finance/contracts';
import { analysisScopes } from '@/lib/agent-finance/l3/review';

const reviewSchema=z.object({confirmed:z.literal(true),periods:z.array(z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),days:z.number().int().min(330).max(380),sourceQuality:z.enum(['primary','official_api','licensed_data','secondary','unknown'])}).strict()).min(2).max(24)}).strict();
export async function POST(req:Request,{params}:{params:Promise<{sessionId:string}>}) {
  const auth=await authenticateRequest(req);if(!auth.ok) return auth.response;
  try{assertSameOrigin(req);}catch{return NextResponse.json({error:'Cross-origin mutation rejected'},{status:403});}
  const {sessionId}=await params;const input=reviewSchema.safeParse(await req.json().catch(()=>null));
  if(!z.string().uuid().safeParse(sessionId).success || !input.success) return NextResponse.json({error:'Confirm each annual period duration and source category.'},{status:400});
  const [session]=await db.select().from(agentAnalysisSessions).where(and(eq(agentAnalysisSessions.id,sessionId),eq(agentAnalysisSessions.ownerId,auth.auth.userId),eq(agentAnalysisSessions.status,'awaiting_approval'))).limit(1);
  if(!session?.evidenceSnapshot) return NextResponse.json({error:'No pending financial input review found'},{status:409});
  const foundation=session.evidenceSnapshot as Foundation;const original=financialInputFromFoundation(foundation);
  if(new Set(input.data.periods.map(row=>row.date)).size!==original.periods.length || input.data.periods.length!==original.periods.length || original.periods.some(row=>!input.data.periods.some(period=>period.date===row.date))) return NextResponse.json({error:'Review must match the retained fiscal periods exactly.'},{status:409});
  const request=analyzeSchema.parse(session.requestPayload);
  if(request.portfolioId && !(await analysisScopes(auth.auth.userId,session.securityId)).some(scope=>scope.portfolioId===request.portfolioId && scope.thesisVersionId===request.thesisVersionId)) return NextResponse.json({error:'Linked thesis is no longer active.'},{status:409});
  const result=await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${auth.auth.userId},0))`);
    const active=await tx.select({id:agentAnalysisSessions.id}).from(agentAnalysisSessions).where(and(eq(agentAnalysisSessions.ownerId,auth.auth.userId),sql`${agentAnalysisSessions.status} in ('queued','running')`)).limit(3);
    if(active.length>=3) return 'capacity';
    const reviewedAt=new Date().toISOString();
    const [row]=await tx.update(agentAnalysisSessions).set({status:'queued',attempts:0,error:null,evidenceSnapshot:{...foundation,financialReview:{reviewedAt,periods:input.data.periods}},updatedAt:new Date()}).where(and(eq(agentAnalysisSessions.id,sessionId),eq(agentAnalysisSessions.ownerId,auth.auth.userId),eq(agentAnalysisSessions.status,'awaiting_approval'))).returning({id:agentAnalysisSessions.id});
    if(!row) return null;
    await tx.update(agentRuns).set({status:'superseded_by_input_review'}).where(and(eq(agentRuns.sessionId,sessionId),eq(agentRuns.agentName,'financial-statement-analyzer'),eq(agentRuns.status,'completed')));
    await tx.insert(agentSessionEvents).values({sessionId,eventType:'resumed',summary:'Financial input review recorded. Recalculate statements before optional value scoring.',detail:`Reviewed by ${auth.auth.actorUserId}. Dates, durations and source classifications were confirmed; missing values were not filled.`,authority:'approval_required',consequence:'high',reversible:1});
    return row;
  });
  if(result==='capacity') return NextResponse.json({error:'Three analyses are already active.'},{status:429});
  return result ? NextResponse.json({sessionId,status:'queued'}) : NextResponse.json({error:'Run state changed; refresh and retry.'},{status:409});
}
