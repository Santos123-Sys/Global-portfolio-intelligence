import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { queueApprovedCandidateResearch } from '@/lib/canonical-candidate-analysis';
import { approveMarketBriefForFinancialAnalysis, failCandidateAnalysisPreparation, retryCandidateMarketBrief } from '@/lib/discovery-workflow';

export const runtime = 'nodejs';
const actionSchema = z.object({ candidateId: z.string().uuid(), action: z.enum(['approve_and_analyze', 'retry']) }).strict();

export async function POST(request: Request) {
  const session = await authenticateRequest(request);
  if (!session.ok) return session.response;
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    if (parsed.data.action === 'retry') {
      const candidate = await retryCandidateMarketBrief(session.auth.userId, parsed.data.candidateId);
      return NextResponse.json({ candidate }, { status: 202 });
    }
    await approveMarketBriefForFinancialAnalysis(session.auth.userId, parsed.data.candidateId);
    after(async () => {
      try { await queueApprovedCandidateResearch(session.auth.userId, parsed.data.candidateId); }
      catch (error) {
        try { await failCandidateAnalysisPreparation(session.auth.userId, parsed.data.candidateId, error); } catch { /* the durable candidate state remains visible */ }
      }
    });
    return NextResponse.json({ status: 'analysis_preparing', orchestrator: 'research_director' }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Market brief action failed' }, { status: 409 });
  }
}
