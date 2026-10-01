import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { agentAnalysisSessions, agentRuns, agentSessionEvents } from '@/lib/db/agent-schema';
import { sessionControlSchema, controlTransition } from '@/lib/agent-finance/l3/session-control';
import { analyzeSchema } from '@/lib/agent-finance/contracts';
import { analysisScopes } from '@/lib/agent-finance/l3/review';

export const runtime='nodejs';
export async function POST(req:Request,{params}:{params:Promise<{sessionId:string}>}) {
  const auth=await authenticateRequest(req); if(!auth.ok) return auth.response;
  try {assertSameOrigin(req);} catch {return NextResponse.json({error:'Cross-origin mutation rejected'},{status:403});}
  const {sessionId}=await params;
  if(!z.string().uuid().safeParse(sessionId).success) return NextResponse.json({error:'Invalid session ID'},{status:400});
  const command=sessionControlSchema.safeParse(await req.json().catch(()=>null));
  if(!command.success) return NextResponse.json({error:'Explicit confirmation and valid action required'},{status:400});
  const action=command.data.action;
  const [session]=await db.select().from(agentAnalysisSessions).where(and(eq(agentAnalysisSessions.id,sessionId),eq(agentAnalysisSessions.ownerId,auth.auth.userId))).limit(1);
  if(!session) return NextResponse.json({error:'Session not found'},{status:404});
  const next=controlTransition(session.status,action);
  if(!next) return NextResponse.json({error:'Action unavailable for the current run state'},{status:409});
  if(next==='queued') {
    const request=analyzeSchema.parse(session.requestPayload);
    if(request.portfolioId) {
      const scopes=await analysisScopes(auth.auth.userId,session.securityId);
      if(!scopes.some(scope=>scope.portfolioId===request.portfolioId && scope.thesisVersionId===request.thesisVersionId)) return NextResponse.json({error:'The linked thesis is no longer active. Start a new analysis against an active thesis.'},{status:409});
    }
  }
  const updated=await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${auth.auth.userId}, 0))`);
    if(next==='queued') {
      const active=await tx.select({id:agentAnalysisSessions.id}).from(agentAnalysisSessions).where(and(eq(agentAnalysisSessions.ownerId,auth.auth.userId),sql`${agentAnalysisSessions.status} in ('queued','running')`)).limit(3);
      if(active.length>=3) return 'capacity' as const;
    }
    const [row]=await tx.update(agentAnalysisSessions).set({status:next,leaseOwner:null,leaseExpiresAt:null,updatedAt:new Date(),completedAt:next==='cancelled'?new Date():null,...(next==='queued'?{attempts:0,error:null}:{} )})
      .where(and(eq(agentAnalysisSessions.id,sessionId),eq(agentAnalysisSessions.ownerId,auth.auth.userId),eq(agentAnalysisSessions.status,session.status))).returning({id:agentAnalysisSessions.id});
    if(!row) return null;
    if(['paused','cancelled'].includes(next)) await tx.update(agentRuns).set({status:'interrupted',completedAt:new Date()}).where(and(eq(agentRuns.sessionId,sessionId),eq(agentRuns.status,'running')));
    await tx.insert(agentSessionEvents).values({sessionId,eventType:next==='queued'?'resumed':next,summary:action==='retry'?'Retry queued with retained evidence and completed steps.':next==='paused'?'Research paused. Completed steps are retained.':next==='cancelled'?'Research cancelled; no portfolio change was made.':'Research resumed from retained evidence.',detail:'Already-sent provider requests cannot be revoked; superseded workers cannot publish their results or initiate new steps.',authority:'human_only',consequence:'medium',reversible:next==='cancelled'?0:1});
    return row;
  });
  if(updated==='capacity') return NextResponse.json({error:'Three analyses are already active.'},{status:429});
  if(!updated) return NextResponse.json({error:'Run state changed; refresh and try again.'},{status:409});
  return NextResponse.json({sessionId,status:next},{headers:{'Cache-Control':'no-store'}});
}
