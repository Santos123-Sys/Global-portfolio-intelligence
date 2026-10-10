import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { accountCanEdit } from '@/lib/account-scope';
import { readBoundedJson } from '@/lib/request-body';
import { HandoffError, listReviews, reviewResearch } from '@/lib/integrations/review-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store' };

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    const reviews = await listReviews(session.auth.userId);
    return NextResponse.json({ reviews, delivery: 'disabled_pending_provider_contract' }, { headers });
  } catch {
    return NextResponse.json({ error: 'Review history unavailable' }, { status: 503, headers });
  }
}

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  if (!accountCanEdit(session.auth.role))
    return NextResponse.json({ error: 'Read-only membership' }, { status: 403, headers });
  try { assertSameOrigin(req); }
  catch { return NextResponse.json({ error: 'Same-origin request required' }, { status: 403, headers }); }
  const body = await readBoundedJson(req, 4096);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  try {
    const result = await reviewResearch(session.auth.userId, session.auth.accountId, session.auth.actorUserId, body.value);
    return NextResponse.json(result, { status: result.reused ? 200 : 201, headers });
  } catch (e) {
    if (e instanceof HandoffError)
      return NextResponse.json({ error: e.code }, { status: e.code === 'identity_not_confirmed' ? 422 : 409, headers });
    if (e instanceof ZodError)
      return NextResponse.json({ error: 'Invalid human review request' }, { status: 422, headers });
    return NextResponse.json({ error: 'Review could not be recorded' }, { status: 503, headers });
  }
}
