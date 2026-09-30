import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { agentAnalysisSessions } from '@/lib/db/agent-schema';

export async function GET(req: Request) {
  const auth = await authenticateRequest(req); if (!auth.ok) return auth.response;
  const securityId = new URL(req.url).searchParams.get('securityId');
  if (securityId && !z.string().uuid().safeParse(securityId).success) return NextResponse.json({ error: 'Invalid security ID' }, { status: 400 });
  const rows = await db.select().from(agentAnalysisSessions).where(and(eq(agentAnalysisSessions.ownerId, auth.auth.userId), securityId ? eq(agentAnalysisSessions.securityId, securityId) : undefined)).orderBy(desc(agentAnalysisSessions.createdAt)).limit(20);
  return NextResponse.json({ sessions: rows }, { headers: { 'Cache-Control': 'no-store' } });
}
