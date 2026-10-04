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
  const view=new URL(req.url).searchParams.get('view');
  const operationsView=view==='operations';
  if(operationsView&&!auth.auth.isPlatformAdmin)return NextResponse.json({error:'Agent operations are restricted to the platform administrator'},{status:403});
  const companyView=view==='company';
  const [session] = await db.select().from(agentAnalysisSessions).where(and(eq(agentAnalysisSessions.id, sessionId),operationsView?undefined:eq(agentAnalysisSessions.ownerId, auth.auth.userId))).limit(1);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  const [runs,recentEvents,recentTraces]=await Promise.all([
    db.select({id:agentRuns.id,agentName:agentRuns.agentName,status:agentRuns.status,startedAt:agentRuns.startedAt,completedAt:agentRuns.completedAt,outputPayload:agentRuns.outputPayload,executionTimeMs:agentRuns.executionTimeMs,configurationHash:agentRuns.configurationHash}).from(agentRuns).where(eq(agentRuns.sessionId, session.id)).orderBy(asc(agentRuns.startedAt)),
    db.select().from(agentSessionEvents).where(eq(agentSessionEvents.sessionId,session.id)).orderBy(desc(agentSessionEvents.occurredAt)).limit(1000),
    companyView?Promise.resolve([]):db.select().from(agentToolTraces).where(eq(agentToolTraces.sessionId,session.id)).orderBy(desc(agentToolTraces.createdAt)).limit(1000),
  ]);
  const events=recentEvents.reverse().map(event=>({...event,summary:sanitizeActivityDetail(event.summary,500),detail:event.detail?sanitizeActivityDetail(event.detail):event.detail}));
  const traces=recentTraces.reverse();
  const partialOutputs=Object.fromEntries(runs.filter(run=>run.status==='completed').flatMap(run=>{const output=outputSchema.safeParse(run.outputPayload);return output.success ? [[run.agentName,output.data]] : [];}));
  const request=analyzeSchema.parse(session.requestPayload);
  const plan = executionPlan(request.analysisType);
  const dynamicRuns=[...new Set(runs.filter(run=>run.agentName.startsWith('dynamic-research-')).map(run=>run.agentName))];
  if(dynamicRuns.length) {
    const insertion=Math.max(0,plan.indexOf('market-industry-research')+1);
    plan.splice(insertion,0,...dynamicRuns);
  }
  if(runs.some(run=>run.agentName==='value-scorecard-analyst')) plan.push('value-scorecard-analyst');
  const done = [...new Set(runs.filter(row => ['completed','failed','blocked','insufficient_data'].includes(row.status)).map(row => row.agentName))];
  const inspector=companyView?null:buildAgentActivityInspector({configurationSnapshot:session.configurationSnapshot,runs,traces,events});
  const {evidenceSnapshot,configurationSnapshot,leaseOwner,leaseExpiresAt,requestPayload,ownerId,...publicSession}=session;void evidenceSnapshot;void configurationSnapshot;void leaseOwner;void leaseExpiresAt;void requestPayload;void ownerId;
  const publicRuns=runs.map(run=>({id:run.id,agentName:run.agentName,status:run.status,startedAt:run.startedAt,completedAt:run.completedAt,executionTimeMs:run.executionTimeMs,configurationHash:run.configurationHash}));
  const progress=session.status==='completed'?100:Math.min(99,Math.round(done.filter(name=>plan.includes(name)).length/Math.max(plan.length,1)*100));
  const activeRun=runs.filter(row=>row.status==='running').at(-1);
  const visibleEvents=companyView?events.slice(-6):events;
  const liveStatus=companyView?{phase:session.phase.replaceAll('_',' '),currentAgent:activeRun?.agentName.replaceAll('-',' ')??null,latestActivity:visibleEvents.at(-1)?.summary??null,updatedAt:session.updatedAt.toISOString(),progress}:null;
  return NextResponse.json({ ...publicSession,ticker:request.ticker,error:session.error?sanitizeActivityDetail(session.error):null,sessionId,portfolioLinked:Boolean(request.portfolioId),partialOutputs,progress,agentsCompleted:done,agentsPending:plan.filter(name=>!done.includes(name)),currentAgent:activeRun?.agentName??null,runs:companyView?undefined:publicRuns,events:visibleEvents,inspector,liveStatus,briefing:runBriefing(session,runs) },{headers:{'Cache-Control':'no-store'}});
}
