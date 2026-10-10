import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { loadWorkspace } from '@/lib/foundation/store';
import { resolveIssuer } from '@/lib/integrations/shared-contracts';
import { readApprovedValuation, ProviderReadError } from '@/lib/integrations/external-readers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store' };
export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  if (process.env.FILINGLENS_VALUATION_READ_ENABLED !== 'true')
    return NextResponse.json({ status: 'disabled', reason: 'Approved valuation publisher not enabled' }, { headers });
  const url = new URL(req.url);
  const candidateKey = url.searchParams.get('candidateKey') ?? '';
  const valuationVersionId = url.searchParams.get('valuationVersionId') ?? '';
  if (!/^[A-Z0-9.:-]{1,60}$/.test(candidateKey) || !/^[A-Za-z0-9._:-]{1,120}$/.test(valuationVersionId))
    return NextResponse.json({ error: 'Invalid issuer or valuation version' }, { status: 422, headers });
  try {
    const workspace = await loadWorkspace(session.auth.userId);
    const candidate = workspace.candidates.find(c => c.key === candidateKey);
    if (!candidate) return NextResponse.json({ error: 'Candidate not found in authorized workspace' }, { status: 404, headers });
    const identity = resolveIssuer(candidate);
    if (identity.status !== 'source_linked')
      return NextResponse.json({ status: 'identity_unmapped' }, { status: 409, headers });
    const valuation = await readApprovedValuation(valuationVersionId, identity.issuer.issuerId, {
      baseUrl: process.env.FILINGLENS_API_URL ?? '',
      token: process.env.FILINGLENS_VALUATION_READ_API_TOKEN ?? '',
    });
    return NextResponse.json({ status: 'ready', valuation }, { headers });
  } catch (e) {
    const code = e instanceof ProviderReadError ? e.code : 'read_unavailable';
    return NextResponse.json({ status: 'unavailable', reason: code }, { status: 503, headers });
  }
}
