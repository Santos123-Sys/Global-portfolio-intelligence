import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { agentAnalysisSessions, agentRuns } from '@/lib/db/agent-schema';

export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string; agentId: string }> }) {
  const auth = await authenticateRequest(req); if (!auth.ok) return auth.response;
  const { sessionId, agentId } = await params;
  if (!z.string().uuid().safeParse(sessionId).success || !z.string().uuid().safeParse(agentId).success) return NextResponse.json({ error: 'Invalid identifier' }, { status: 400 });
  const [row] = await db.select({ run: agentRuns }).from(agentRuns).innerJoin(agentAnalysisSessions, eq(agentRuns.sessionId, agentAnalysisSessions.id))
    .where(and(eq(agentRuns.id, agentId), eq(agentRuns.sessionId, sessionId), eq(agentAnalysisSessions.ownerId, auth.auth.userId))).limit(1);
  if (!row) return NextResponse.json({ error: 'Agent run not found' }, { status: 404 });
  return NextResponse.json({ agentName: row.run.agentName, input: row.run.inputPayload, output: row.run.outputPayload,
    reasoningChain: JSON.parse(row.run.reasoningChain ?? '[]'), confidenceScore: Number(row.run.confidenceScore ?? 0), executionTimeMs: row.run.executionTimeMs });
}
