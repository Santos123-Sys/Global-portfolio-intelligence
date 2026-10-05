import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { dashboardData } from '@/lib/company-intelligence';
import { analyzeSchema } from '@/lib/agent-finance/contracts';
import { assertSameOrigin } from '@/lib/auth';
import { analysisScopes } from '@/lib/agent-finance/l3/review';
import { AnalysisQueueCapacityError, queueAnalysisSession } from '@/lib/agent-finance/queue-session';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(req: Request) {
  const auth = await authenticateRequest(req); if (!auth.ok) return auth.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({error:'Cross-origin mutation rejected'},{status:403}); }
  const parsed = analyzeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid analysis request', details: parsed.error.flatten() }, { status: 400 });
  const data = await dashboardData(parsed.data.ticker, auth.auth.userId, false);
  if (!data) return NextResponse.json({ error: 'Security not found in your research or portfolio' }, { status: 404 });
  const scopes=await analysisScopes(auth.auth.userId,data.securityId);
  const scope=parsed.data.portfolioId ? scopes.find(row=>row.portfolioId===parsed.data.portfolioId && row.thesisVersionId===parsed.data.thesisVersionId) : scopes.length===1 ? scopes[0] : null;
  if((parsed.data.portfolioId || parsed.data.thesisVersionId) && !scope) return NextResponse.json({error:'Select an active owned thesis linked to this security'},{status:409});
  if(scopes.length>1 && !scope) return NextResponse.json({error:'Select the portfolio and thesis for this analysis'},{status:409});
  if(scope) Object.assign(parsed.data,{portfolioId:scope.portfolioId,thesisVersionId:scope.thesisVersionId});
  try {
    const row = await queueAnalysisSession({ ownerId: auth.auth.userId, securityId: data.securityId, request: parsed.data, origin: 'direct' });
    // Railway worker claims queued sessions from the dashboard database. Requests never own execution.
    return NextResponse.json({ sessionId: row.id, status: row.status, estimatedCompletionSeconds: null }, { status: 202 });
  } catch (error) {
    if (error instanceof AnalysisQueueCapacityError) return NextResponse.json({ error: error.message }, { status: 429 });
    throw error;
  }
}
