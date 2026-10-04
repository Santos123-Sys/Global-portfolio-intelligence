import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { agentAnalysisSessions, agentSessionEvents } from '@/lib/db/agent-schema';
import { analyzeSchema } from '@/lib/agent-finance/contracts';
import { assertSameOrigin } from '@/lib/auth';
import { analysisScopes } from '@/lib/agent-finance/l3/review';
import { resolveSecurityForResearch } from '@/lib/research-security';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(req: Request) {
  const auth = await authenticateRequest(req); if (!auth.ok) return auth.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({error:'Cross-origin mutation rejected'},{status:403}); }
  const parsed = analyzeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid analysis request', details: parsed.error.flatten() }, { status: 400 });

  let resolved: Awaited<ReturnType<typeof resolveSecurityForResearch>>;
  try {
    resolved = await resolveSecurityForResearch(parsed.data.ticker);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Company could not be resolved for research' }, { status: 422 });
  }
  parsed.data.ticker = resolved.security.ticker;

  const scopes=await analysisScopes(auth.auth.userId,resolved.security.id);
  const scope=parsed.data.portfolioId ? scopes.find(row=>row.portfolioId===parsed.data.portfolioId && row.thesisVersionId===parsed.data.thesisVersionId) : scopes.length===1 ? scopes[0] : null;
  if((parsed.data.portfolioId || parsed.data.thesisVersionId) && !scope) return NextResponse.json({error:'Select an active owned thesis linked to this security'},{status:409});
  if(scopes.length>1 && !scope) return NextResponse.json({error:'Select the portfolio and thesis for this analysis'},{status:409});
  if(scope) Object.assign(parsed.data,{portfolioId:scope.portfolioId,thesisVersionId:scope.thesisVersionId});

  const row = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${auth.auth.userId}, 0))`);
    const active = await tx.select({ id: agentAnalysisSessions.id }).from(agentAnalysisSessions).where(and(eq(agentAnalysisSessions.ownerId, auth.auth.userId), inArray(agentAnalysisSessions.status, ['queued', 'running']))).limit(3);
    if (active.length >= 3) return null;
    const [created] = await tx.insert(agentAnalysisSessions).values({ ownerId: auth.auth.userId, securityId: resolved.security.id, sessionType: parsed.data.analysisType, requestPayload: parsed.data }).returning();
    const sourceNote = resolved.resolvedBy === 'fmp'
      ? `Financial Modeling Prep resolved ${resolved.security.companyName} and retained ${resolved.hydration?.financialPeriods ?? 0} annual financial periods plus ${resolved.hydration?.prices ?? 0} price observations before research.`
      : `Using the existing local security record for ${resolved.security.companyName}.`;
    await tx.insert(agentSessionEvents).values({sessionId:created.id,eventType:'plan_created',summary:`Research queued for ${resolved.security.companyName} (${resolved.security.ticker}).`,detail:`${sourceNote} Research only. No orders, weight changes or automatic report acceptance.`,authority:'autonomous',consequence:'low',reversible:1});
    return created;
  });
  if (!row) return NextResponse.json({ error: 'Three analyses are already active; wait before starting another.' }, { status: 429 });
  return NextResponse.json({
    sessionId: row.id,
    status: row.status,
    ticker: resolved.security.ticker,
    companyName: resolved.security.companyName,
    securityId: resolved.security.id,
    resolvedBy: resolved.resolvedBy,
    hydration: resolved.hydration,
    estimatedCompletionSeconds: null,
  }, { status: 202 });
}
