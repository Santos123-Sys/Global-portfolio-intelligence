import { NextResponse } from 'next/server';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { agentAnalysisSessions, agentMemoryEvents } from '@/lib/db/agent-schema';
import { aiAnalyses, portfolios, thesisVersions } from '@/lib/db/schema';
import { analyzeSchema } from '@/lib/agent-finance/contracts';
import { canAcceptReport,reviewSchema } from '@/lib/agent-finance/l3/review';

export async function POST(req:Request,{params}:{params:Promise<{sessionId:string}>}) {
  const auth=await authenticateRequest(req); if(!auth.ok) return auth.response;
  try {assertSameOrigin(req);} catch {return NextResponse.json({error:'Cross-origin mutation rejected'},{status:403});}
  const {sessionId}=await params;
  const parsed=reviewSchema.safeParse(await req.json().catch(()=>null));
  if(!z.string().uuid().safeParse(sessionId).success || !parsed.success) return NextResponse.json({error:'Review every required field before accepting'},{status:400});
  const result=await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${sessionId},0))`);
    const [session]=await tx.select().from(agentAnalysisSessions).where(and(eq(agentAnalysisSessions.id,sessionId),eq(agentAnalysisSessions.ownerId,auth.auth.userId),eq(agentAnalysisSessions.status,'completed')));
    if(!session) return null;
    const report=session.finalOutput as Parameters<typeof canAcceptReport>[0] & {citations:string[];limitations:string[]};
    if(!canAcceptReport(report)) return null;
    const request=analyzeSchema.parse(session.requestPayload);
    if(!request.portfolioId || !request.thesisVersionId) return null;
    // Recheck ownership and active thesis inside the same transaction; excluded theses cannot be republished.
    const [portfolio]=await tx.select().from(portfolios).where(and(eq(portfolios.id,request.portfolioId),eq(portfolios.ownerId,auth.auth.userId))).for('share');
    const [thesis]=await tx.select().from(thesisVersions).where(and(eq(thesisVersions.id,request.thesisVersionId),eq(thesisVersions.ownerId,auth.auth.userId),isNull(thesisVersions.excludedAt),isNull(thesisVersions.supersededAt))).for('share');
    if(!portfolio || !thesis) return null;
    const [already]=await tx.select({id:aiAnalyses.id}).from(aiAnalyses).where(and(eq(aiAnalyses.ownerId,auth.auth.userId),eq(aiAnalyses.externalRunId,sessionId)));
    if(already) return already;
    const [previous]=await tx.select({id:aiAnalyses.id}).from(aiAnalyses).where(and(eq(aiAnalyses.ownerId,auth.auth.userId),eq(aiAnalyses.securityId,session.securityId),eq(aiAnalyses.portfolioId,request.portfolioId))).orderBy(desc(aiAnalyses.analysisTimestamp)).limit(1);
    const p=parsed.data;
    const [created]=await tx.insert(aiAnalyses).values({ownerId:auth.auth.userId,portfolioId:request.portfolioId,thesisVersionId:request.thesisVersionId,securityId:session.securityId,
      portfolioRole:p.portfolioRole,investmentScore:p.investmentScore,thesisAlignmentScore:p.thesisAlignmentScore,qualityScore:p.qualityScore,growthScore:p.growthScore,riskScore:p.riskScore,
      fundamentalSummary:p.summary,investmentThesis:p.investmentThesis,keyCatalysts:p.keyCatalysts,keyRisks:p.keyRisks,thesisBreakers:p.thesisBreakers,
      confidenceScore:report.confidenceScore!/100,groundedIn:report.citations,informationGaps:report.limitations,externalRunId:sessionId,supersedesId:previous?.id,agentVersion:'financial-swarms-v2',dataTimestamp:session.startedAt}).returning({id:aiAnalyses.id});
    await tx.insert(agentMemoryEvents).values({ownerId:auth.auth.userId,securityId:session.securityId,agentName:'research-director',memoryType:'procedural',eventType:'human_acceptance',eventContent:{sessionId,analysisId:created.id,reviewedBy:auth.auth.actorUserId,...p}});
    return created;
  });
  return result ? NextResponse.json({analysisId:result.id,accepted:true}) : NextResponse.json({error:'Only fully validated combined reports linked to an active owned thesis can be accepted'},{status:409});
}
