import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { ThesisCriteria } from '@portfolio-intelligence/agentic-contract';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { thesisVersions } from '@/lib/db/schema';
import { readBoundedJson } from '@/lib/request-body';
import { assessThesisReview } from '@/lib/thesis-review';
import { criteriaFromPortfolioStrategy } from '@/lib/portfolio-strategy-chat';
import { interviewPortfolioStrategy, PortfolioCreatorConfigurationError } from '@/lib/portfolio-creator-gemini';
import { applyCreatorAction, CreatorAction, CreatorTurn, prepareCreatorTurn, completeCreatorTurn, requiredCreatorProfile } from '@/lib/portfolio-creator-state';
import { loadCreatorSession, saveCreatorSession, CreatorConflictError } from '@/lib/portfolio-creator-store';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    const saved = await loadCreatorSession(session.auth.userId);
    const stalled = saved.state.generationStatus === 'working' && Date.now() - Date.parse(saved.state.generationStartedAt ?? '') > 70_000;
    return NextResponse.json({ ...saved, stalled }, { headers });
  } catch {
    return NextResponse.json({ error: 'Portfolio Creator could not load the saved interview. Retry loading before answering.' }, { status: 503, headers });
  }
}
export async function PATCH(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  const body = await readBoundedJson(req, 8192);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = CreatorAction.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    const saved = await loadCreatorSession(session.auth.userId);
    if (saved.revision !== parsed.data.revision) throw new CreatorConflictError('The saved interview changed. Reload before continuing.');
    const state = applyCreatorAction(saved.state, parsed.data);
    return NextResponse.json(await saveCreatorSession(session.auth.userId, saved.revision, state), { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save this answer' }, { status: error instanceof CreatorConflictError ? 409 : 422, headers });
  }
}
export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  const body = await readBoundedJson(req, 64 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = CreatorTurn.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  let working: Awaited<ReturnType<typeof loadCreatorSession>> | undefined;
  try {
    const saved = await loadCreatorSession(session.auth.userId);
    if (saved.revision !== parsed.data.revision) throw new CreatorConflictError('The saved interview changed. Reload before continuing.');
    const state = prepareCreatorTurn(saved.state, parsed.data);
    working = await saveCreatorSession(session.auth.userId, saved.revision, state);
    const [latest] = await db.select({ versionNumber: thesisVersions.versionNumber }).from(thesisVersions)
      .where(eq(thesisVersions.ownerId, session.auth.userId)).orderBy(desc(thesisVersions.versionNumber)).limit(1);
    const nextVersion = (latest?.versionNumber ?? 0) + 1;
    let result = await interviewPortfolioStrategy({ messages: state.messages, currentDraft: state.draft, nextVersion }, requiredCreatorProfile(state));
    if (result.status === 'ready' && result.draft) {
      const criteria = ThesisCriteria.parse(criteriaFromPortfolioStrategy(result.draft, nextVersion));
      const review = assessThesisReview(criteria);
      if (review.errors.length) result = { reply: `The draft still needs clarification: ${review.errors.slice(0, 4).join(' ')}`, status: 'clarifying', missingFields: review.errors.slice(0, 8), draft: null };
    }
    return NextResponse.json(await saveCreatorSession(session.auth.userId, working.revision, completeCreatorTurn(state, result)), { headers });
  } catch (error) {
    if (error instanceof CreatorConflictError) return NextResponse.json({ error: error.message }, { status: 409, headers });
    const configMissing = error instanceof PortfolioCreatorConfigurationError;
    const message = working
      ? configMissing ? 'Portfolio Creator is not configured. Add GEMINI_API_KEY to the Railway dashboard service.' : 'Portfolio Creator could not complete this turn. Your answer is saved; retry or edit it.'
      : error instanceof Error ? error.message : 'Complete the investor profile before continuing';
    if (working) {
      try {
        const saved = await saveCreatorSession(session.auth.userId, working.revision, { ...working.state, generationStatus: 'failed', generationStartedAt: null, error: message });
        return NextResponse.json({ ...saved, error: message }, { status: configMissing ? 503 : 502, headers });
      } catch { /* A cancelled or superseded turn may not overwrite newer state. */ }
    }
    return NextResponse.json({ error: message }, { status: working ? 502 : 422, headers });
  }
}
