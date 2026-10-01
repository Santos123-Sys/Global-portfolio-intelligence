import { NextResponse } from 'next/server';
import { and, eq, asc, desc } from 'drizzle-orm';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { agentAnalysisSessions, agentRuns, agentSessionEvents, agentToolTraces } from '@/lib/db/agent-schema';
import { analyzeSchema, executionPlan, outputSchema } from '@/lib/agent-finance/contracts';
import { runBriefing } from '@/lib/agent-finance/l3/session-control';
import { buildAgentActivityInspector } from '@/lib/agent-finance/activity-inspector';
import { sanitizeActivityDetail } from '@/lib/agent-finance/l3/session-events';

export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const auth = await authenticateRequest(req); if (!auth.ok) return auth.response;
  const { sessionId } = await params;
  if (!z.string().uuid().safeParse(sessionId).success) return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
  const [session] = await db.select().from(agentAnalysisSessions).where(and(eq(agentAnalysisSessions.id, sessionId), eq(agentAnalysisSessions.ownerId, auth.auth.userId))).limit(1);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  const [runs,recentEvents,recentTraces]=await Promise.all([
    db.select({id:agentRuns.id,agentName:agentRuns.agentName,status:agentRuns.status,startedAt:agentRuns.startedAt,completedAt:agentRuns.completedAt,outputPayload:agentRuns.outputPayload,executionTimeMs:agentRuns.executionTimeMs,configurationHash:agentRuns.configurationHash}).from(agentRuns).where(eq(agentRuns.sessionId, session.id)).orderBy(asc(agentRuns.startedAt)),
    db.select().from(agentSessionEvents).where(eq(agentSessionEvents.sessionId,session.id)).orderBy(desc(agentSessionEvents.occurredAt)).limit(1000),
    db.select().from(agentToolTraces).where(eq(agentToolTraces.sessionId,session.id)).orderBy(desc(agentToolTraces.createdAt)).limit(1000),
  ]);
  const events=recentEvents.reverse().map(event=>({...event,summary:sanitizeActivityDetail(event.summary,500),detail:event.detail?sanitizeActivityDetail(event.detail):event.detail}));
  const traces=recentTraces.reverse();
  const partialOutputs=Object.fromEntries(runs.filter(run=>run.status==='completed').flatMap(run=>{const output=outputSchema.safeParse(run.outputPayload);return output.success ? [[run.agentName,output.data]] : [];}));
  const request=analyzeSchema.parse(session.requestPayload);
  const plan = executionPlan(request.analysisType);
  if(runs.some(run=>run.agentName==='value-scorecard-analyst')) plan.push('value-scorecard-analyst');
  const done = [...new Set(runs.filter(row => ['completed','failed','blocked','insufficient_data'].includes(row.status)).map(row => row.agentName))];
  const inspector=buildAgentActivityInspector({configurationSnapshot:session.configurationSnapshot,runs,traces,events});
  const {evidenceSnapshot,configurationSnapshot,leaseOwner,leaseExpiresAt,requestPayload,...publicSession}=session;void evidenceSnapshot;void configurationSnapshot;void leaseOwner;void leaseExpiresAt;void requestPayload;
  const publicRuns=runs.map(run=>({id:run.id,agentName:run.agentName,status:run.status,startedAt:run.startedAt,completedAt:run.completedAt,executionTimeMs:run.executionTimeMs,configurationHash:run.configurationHash}));
  return NextResponse.json({ ...publicSession,error:session.error?sanitizeActivityDetail(session.error):null,sessionId,portfolioLinked:Boolean(request.portfolioId),partialOutputs,progress:session.status==='completed'?100:Math.min(99,Math.round(done.filter(name=>plan.includes(name)).length/plan.length*100)),agentsCompleted:done,agentsPending:plan.filter(name=>!done.includes(name)),currentAgent:runs.filter(row=>row.status==='running').at(-1)?.agentName??null,runs:publicRuns,events,inspector,briefing:runBriefing(session,runs) },{headers:{'Cache-Control':'no-store'}});
}
