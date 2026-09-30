import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { agentAnalysisSessions, agentMemoryEvents } from '@/lib/db/agent-schema';

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const auth = await authenticateRequest(req); if (!auth.ok) return auth.response;
  const { sessionId } = await params;
  const payload = z.object({ accuracyScore: z.number().min(0).max(100), comments: z.string().max(2000).optional() }).strict().safeParse(await req.json().catch(() => null));
  if (!z.string().uuid().safeParse(sessionId).success || !payload.success) return NextResponse.json({ error: 'Invalid feedback' }, { status: 400 });
  const result = await db.transaction(async tx => {
    const [session] = await tx.update(agentAnalysisSessions).set({ accuracyScore: String(payload.data.accuracyScore) }).where(and(eq(agentAnalysisSessions.id, sessionId), eq(agentAnalysisSessions.ownerId, auth.auth.userId), eq(agentAnalysisSessions.status, 'completed'))).returning();
    if (!session) return false;
    await tx.insert(agentMemoryEvents).values({ ownerId: session.ownerId, securityId: session.securityId, agentName: 'research-director', memoryType: 'procedural', eventType: 'human_feedback', eventContent: { sessionId, ...payload.data }, expiresAt: new Date(Date.now() + 90 * 86400_000) });
    return true;
  });
  return result ? NextResponse.json({ recorded: true }) : NextResponse.json({ error: 'Completed session not found' }, { status: 404 });
}
