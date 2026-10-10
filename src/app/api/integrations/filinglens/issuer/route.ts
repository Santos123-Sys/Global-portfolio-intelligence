import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { loadWorkspace } from '@/lib/foundation/store';
import { loadFilingLensFinance } from '@/lib/integrations/filinglens-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };

/**
 * Workspace-scoped, on-demand public financial evidence. Client-supplied
 * ticker/CIK/CNPJ values are ignored: the issuer comes from the saved watchlist
 * and the connector's independently configured, verified identity crosswalk.
 * This endpoint never requests private uploads, valuations or analysis writes.
 */
export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;

  const url = new URL(req.url);
  const values = url.searchParams.getAll('candidateKey');
  if (values.length !== 1 || !/^[A-Z0-9.:-]{1,60}$/.test(values[0])) {
    return NextResponse.json({ error: 'invalid_candidate_key' }, { status: 400, headers });
  }
  try {
    const workspace = await loadWorkspace(session.auth.userId);
    const candidate = workspace.candidates.find(item => item.key === values[0]);
    if (!candidate) {
      return NextResponse.json({ error: 'candidate_not_found' }, { status: 404, headers });
    }

    const finance = await loadFilingLensFinance({ ticker: candidate.ticker, exchange: candidate.exchange });
    // A workspace may be imported from an external list. Never display a
    // snapshot for a different claimed issuer even when the ticker matches.
    if (finance.status === 'ready' && candidate.issuer &&
        (finance.snapshot.issuer.jurisdiction !== candidate.issuer.jurisdiction ||
         finance.snapshot.issuer.registryId !== candidate.issuer.registryId)) {
      return NextResponse.json({ candidateKey: candidate.key, finance: {
        status: 'unavailable', reason: 'issuer_identity_conflict',
      } }, { status: 409, headers });
    }

    return NextResponse.json({ candidateKey: candidate.key, finance }, { headers });
  } catch {
    return NextResponse.json({ error: 'finance_preview_unavailable' }, { status: 503, headers });
  }
}
