import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { ThesisCriteria } from '@portfolio-intelligence/agentic-contract';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { thesisVersions } from '@/lib/db/schema';
import { readBoundedJson } from '@/lib/request-body';
import { assessThesisReview } from '@/lib/thesis-review';
import { criteriaFromPortfolioStrategy, StrategyChatRequest } from '@/lib/portfolio-strategy-chat';
import { interviewPortfolioStrategy } from '@/lib/portfolio-strategy-gemini';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  const body = await readBoundedJson(req, 64 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });

  try {
    const [latest] = await db.select({ versionNumber: thesisVersions.versionNumber })
      .from(thesisVersions).where(eq(thesisVersions.ownerId, session.auth.userId))
      .orderBy(desc(thesisVersions.versionNumber)).limit(1);
    const nextVersion = (latest?.versionNumber ?? 0) + 1;
    const parsedInput = StrategyChatRequest.safeParse({ ...(body.value as Record<string, unknown>), nextVersion });
    if (!parsedInput.success) return NextResponse.json({ error: parsedInput.error.flatten() }, { status: 400 });
    const result = await interviewPortfolioStrategy(parsedInput.data);
    if (result.status !== 'ready' || !result.draft) return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });

    const criteria = ThesisCriteria.parse(criteriaFromPortfolioStrategy(result.draft, nextVersion));
    const review = assessThesisReview(criteria);
    if (review.errors.length) {
      return NextResponse.json({
        reply: `I have a draft, but it still needs these details before review: ${review.errors.slice(0, 4).join(' ')} Please clarify them in your next message.`,
        status: 'clarifying',
        missingFields: review.errors.slice(0, 8),
        draft: null,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const missingConfig = message.includes('GEMINI_API_KEY');
    return NextResponse.json({
      error: missingConfig
        ? 'Gemini is not configured on this dashboard service. Add GEMINI_API_KEY to the Railway dashboard service.'
        : 'The strategy assistant could not complete this turn. Your conversation remains in this page; try again.',
    }, { status: missingConfig ? 503 : 502 });
  }
}
