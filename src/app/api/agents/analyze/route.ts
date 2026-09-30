import { after, NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { agentAnalysisSessions } from '@/lib/db/agent-schema';
import { dashboardData } from '@/lib/company-intelligence';
import { analyzeSchema } from '@/lib/agent-finance/contracts';
import { executeSession } from '@/lib/agent-finance/l1/research-director';

export const runtime = 'nodejs';
export const maxDuration = 600;
export async function POST(req: Request) {
  const auth = await authenticateRequest(req); if (!auth.ok) return auth.response;
  const parsed = analyzeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid analysis request', details: parsed.error.flatten() }, { status: 400 });
  if (parsed.data.analysisType !== 'dcf' && !process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'Analysis model is not configured on this service' }, { status: 503 });
  const data = await dashboardData(parsed.data.ticker, auth.auth.userId, false);
  if (!data) return NextResponse.json({ error: 'Security not found in your research or portfolio' }, { status: 404 });
  const row = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${auth.auth.userId}, 0))`);
    const active = await tx.select({ id: agentAnalysisSessions.id }).from(agentAnalysisSessions).where(and(eq(agentAnalysisSessions.ownerId, auth.auth.userId), inArray(agentAnalysisSessions.status, ['queued', 'running']))).limit(3);
    if (active.length >= 3) return null;
    const [created] = await tx.insert(agentAnalysisSessions).values({ ownerId: auth.auth.userId, securityId: data.securityId, sessionType: parsed.data.analysisType, requestPayload: parsed.data }).returning();
    return created;
  });
  if (!row) return NextResponse.json({ error: 'Three analyses are already active; wait before starting another.' }, { status: 429 });
  after(() => executeSession(row.id));
  return NextResponse.json({ sessionId: row.id, status: row.status, estimatedCompletionSeconds: null }, { status: 202 });
}
