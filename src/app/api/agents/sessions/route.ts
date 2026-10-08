import { NextResponse } from 'next/server';
import { and, desc, eq, gte, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { agentAnalysisSessions } from '@/lib/db/agent-schema';
import { users } from '@/lib/db/schema';
import {analysisScopes} from '@/lib/agent-finance/l3/review';
import { analyzeSchema } from '@/lib/agent-finance/contracts';
import { sanitizeActivityDetail } from '@/lib/agent-finance/l3/session-events';
import { summarizeResearchOperations } from '@/lib/agent-finance/operations-telemetry';

export async function GET(req: Request) {
  const auth = await authenticateRequest(req); if (!auth.ok) return auth.response;
  const searchParams=new URL(req.url).searchParams;
  const securityId = searchParams.get('securityId');
  const operations=searchParams.get('operations')==='true';
  if(operations&&!auth.auth.isPlatformAdmin)return NextResponse.json({error:'Agent operations are restricted to the platform administrator'},{status:403});
  if (securityId && !z.string().uuid().safeParse(securityId).success) return NextResponse.json({ error: 'Invalid security ID' }, { status: 400 });
  const rows = await db.select({id:agentAnalysisSessions.id,securityId:agentAnalysisSessions.securityId,ownerName:users.displayName,sessionType:agentAnalysisSessions.sessionType,status:agentAnalysisSessions.status,phase:agentAnalysisSessions.phase,requestPayload:agentAnalysisSessions.requestPayload,error:agentAnalysisSessions.error,modelCalls:agentAnalysisSessions.modelCalls,inputTokens:agentAnalysisSessions.inputTokens,outputTokens:agentAnalysisSessions.outputTokens,unmeteredModelCalls:agentAnalysisSessions.unmeteredModelCalls,estimatedCostUsd:agentAnalysisSessions.estimatedCostUsd,budgetActiveMs:agentAnalysisSessions.budgetActiveMs,startedAt:agentAnalysisSessions.startedAt,updatedAt:agentAnalysisSessions.updatedAt,completedAt:agentAnalysisSessions.completedAt,createdAt:agentAnalysisSessions.createdAt})
    .from(agentAnalysisSessions).leftJoin(users,eq(agentAnalysisSessions.ownerId,users.id)).where(and(operations?undefined:eq(agentAnalysisSessions.ownerId, auth.auth.userId), securityId ? eq(agentAnalysisSessions.securityId, securityId) : undefined)).orderBy(desc(agentAnalysisSessions.createdAt)).limit(50);
  const sessions=rows.map(({requestPayload,...session})=>{const request=analyzeSchema.safeParse(requestPayload);return {...session,ticker:request.success?request.data.ticker:'Unknown issuer',analysisType:request.success?request.data.analysisType:session.sessionType,error:session.error?sanitizeActivityDetail(session.error,1000):null};});
  let telemetry=null;
  if(operations) {
    const cutoff=new Date(Date.now()-24*60*60_000);
    const telemetryRows=await db.select({status:agentAnalysisSessions.status,createdAt:agentAnalysisSessions.createdAt,budgetStartedAt:agentAnalysisSessions.budgetStartedAt,budgetActiveMs:agentAnalysisSessions.budgetActiveMs,completedAt:agentAnalysisSessions.completedAt,modelCalls:agentAnalysisSessions.modelCalls,inputTokens:agentAnalysisSessions.inputTokens,outputTokens:agentAnalysisSessions.outputTokens,unmeteredModelCalls:agentAnalysisSessions.unmeteredModelCalls,estimatedCostUsd:agentAnalysisSessions.estimatedCostUsd})
      .from(agentAnalysisSessions).where(or(inArray(agentAnalysisSessions.status,['queued','running']),gte(agentAnalysisSessions.budgetStartedAt,cutoff))).limit(5000);
    telemetry=summarizeResearchOperations(telemetryRows);
  }
  return NextResponse.json({ sessions, telemetry, scopes:securityId ? await analysisScopes(auth.auth.userId,securityId) : [] }, { headers: { 'Cache-Control': 'no-store' } });
}
