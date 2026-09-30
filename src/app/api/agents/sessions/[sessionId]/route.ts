import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { agentAnalysisSessions, agentRuns } from '@/lib/db/agent-schema';
import { analyzeSchema, executionPlan } from '@/lib/agent-finance/contracts';

export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const auth = await authenticateRequest(req); if (!auth.ok) return auth.response;
  const { sessionId } = await params;
  if (!z.string().uuid().safeParse(sessionId).success) return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
  const [session] = await db.select().from(agentAnalysisSessions).where(and(eq(agentAnalysisSessions.id, sessionId), eq(agentAnalysisSessions.ownerId, auth.auth.userId))).limit(1);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  const runs = await db.select().from(agentRuns).where(eq(agentRuns.sessionId, session.id));
  const plan = executionPlan(analyzeSchema.parse(session.requestPayload).analysisType);
  const done = [...new Set(runs.filter(row => row.status !== 'running').map(row => row.agentName))];
  return NextResponse.json({ ...session, sessionId, progress: session.status === 'completed' ? 100 : Math.round(done.length / plan.length * 100), agentsCompleted: done, agentsPending: plan.filter(name => !done.includes(name)), currentAgent: runs.find(row => row.status === 'running')?.agentName ?? null, runs }, { headers: { 'Cache-Control': 'no-store' } });
}
