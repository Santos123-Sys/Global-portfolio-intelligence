import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from '@/lib/foundation/store';
import { importValuation } from '@/lib/integrations/portfolio-feedback';
import { verifyHandoff } from '@/lib/integrations/workspace-handoff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store' };
const ApprovedEvent = z.object({
  schemaVersion: z.literal('filinglens-valuation-approved.v1'),
  ticket: z.string().min(1).max(2000),
  valuationVersionId: z.string().regex(/^flv1_[a-f0-9]{64}$/),
  issuedAt: z.string().datetime({ offset: true }),
}).strict();

/** Cross-service HMAC covers the exact request body, not an untrusted origin header. */
export function signature(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('filinglens.valuation.approved.v1\n').update(body).digest('hex');
}
export function validSignature(body: string, header: string | null, secret: string): boolean {
  if (secret.length < 32 || !header || !/^sha256=[a-f0-9]{64}$/.test(header)) return false;
  const expected = Buffer.from(signature(body, secret), 'hex');
  const received = Buffer.from(header.slice(7), 'hex');
  return timingSafeEqual(expected, received);
}

/**
 * Called only after explicit human approval and a committed FilingLens valuation.
 * GPI fetches the approved value itself using a dedicated scope-restricted token.
 * The notification contains no private analysis or valuation figures.
 */
export async function POST(req: Request) {
  if (!req.headers.get('content-type')?.startsWith('application/json'))
    return NextResponse.json({ error: 'json_required' }, { status: 415, headers });
  const secret = process.env.INTEGRATION_SIGNING_SECRET ?? '';
  if (secret.length < 32 || process.env.FILINGLENS_VALUATION_READ_ENABLED !== 'true')
    return NextResponse.json({ error: 'synchronization_disabled' }, { status: 503, headers });
  if (Number(req.headers.get('content-length') ?? 0) > 4000)
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413, headers });
  let raw: string;
  try { raw = await req.text(); } catch {
    return NextResponse.json({ error: 'unreadable_body' }, { status: 400, headers });
  }
  if (Buffer.byteLength(raw, 'utf8') > 4000)
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413, headers });
  if (!validSignature(raw, req.headers.get('x-filinglens-signature'), secret))
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers });
  const parsed = ApprovedEvent.safeParse((() => { try { return JSON.parse(raw); } catch { return null; } })());
  if (!parsed.success)
    return NextResponse.json({ error: 'invalid_event' }, { status: 422, headers });
  const event = parsed.data;
  const now = Date.now();
  if (Math.abs(now - Date.parse(event.issuedAt)) > 300_000)
    return NextResponse.json({ error: 'expired_event' }, { status: 410, headers });
  let ctx: ReturnType<typeof verifyHandoff>;
  try { ctx = verifyHandoff(event.ticket, secret); }
  catch { return NextResponse.json({ error: 'invalid_or_expired_handoff' }, { status: 401, headers }); }

  // Resolve the owner from GPI's own database; never trust account/owner IDs sent by FilingLens.
  try {
    const rows = await sql()`SELECT a.owner_user_id
      FROM accounts a
      JOIN memberships m ON m.account_id = a.id
      JOIN users u ON u.id = m.user_id
      WHERE a.id = ${ctx.workspaceId}
        AND m.user_id = ${ctx.reviewerUserId}
        AND m.accepted_at IS NOT NULL
        AND m.role IN ('owner','analyst')
        AND u.disabled_at IS NULL
      LIMIT 1`;
    const owner = rows[0]?.owner_user_id;
    if (typeof owner !== 'string')
      return NextResponse.json({ error: 'workspace_access_denied' }, { status: 403, headers });
    const value = await importValuation(owner, ctx.workspaceId, ctx.candidateKey,
      event.valuationVersionId, { reviewerId: ctx.reviewerUserId, nonce: ctx.nonce });
    const expectedId = 'flv1_' + createHash('sha256').update(ctx.nonce + ':' + value.method).digest('hex');
    if (expectedId !== event.valuationVersionId)
      throw Error('handoff_valuation_mismatch');
    return NextResponse.json({ status: 'synchronized', valuationVersionId: value.valuationVersionId },
      { headers });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'unavailable';
    if (['issuer_unmapped','candidate_not_found','handoff_valuation_mismatch',
      'reviewer_mismatch'].includes(code))
      return NextResponse.json({ error: 'identity_mismatch' }, { status: 409, headers });
    return NextResponse.json({ error: 'synchronization_unavailable' }, { status: 503, headers });
  }
}
