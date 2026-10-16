import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { loadWorkspace } from '@/lib/foundation/store';
import { resolveIssuer } from '@/lib/integrations/shared-contracts';
import { listValuations } from '@/lib/integrations/portfolio-feedback';
import { ProviderReadError, readValuationAudit } from '@/lib/integrations/external-readers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = {'cache-control': 'no-store', vary: 'Cookie'};
export async function GET(request: Request) {
  const session = await authenticateRequest(request);
  if (!session.ok) return session.response;
  const url = new URL(request.url);
  const candidateKey = url.searchParams.get('candidateKey') ?? '';
  const versionId = url.searchParams.get('valuationVersionId') ?? '';
  if (!/^[A-Z0-9.:-]{1,60}$/.test(candidateKey) || !/^flv1_[a-f0-9]{64}$/.test(versionId))
    return NextResponse.json({error: 'invalid_valuation_scope'}, {status: 422, headers});
  if (process.env.FILINGLENS_VALUATION_READ_ENABLED !== 'true')
    return NextResponse.json({status: 'unavailable', reason: 'valuation_evidence_disabled'}, {status: 503, headers});
  try {
    const {userId, accountId} = session.auth;
    const [workspace, valuations] = await Promise.all([loadWorkspace(userId), listValuations(userId, accountId)]);
    const candidate = workspace.candidates.find(item => item.key === candidateKey);
    const saved = valuations.find(item => item.candidateKey === candidateKey && item.valuation.valuationVersionId === versionId);
    if (!candidate || !saved)
      return NextResponse.json({error: 'valuation_not_found'}, {status: 404, headers});
    const identity = resolveIssuer(candidate);
    if (identity.status !== 'source_linked' || saved.valuation.issuerId !== identity.issuer.issuerId)
      return NextResponse.json({error: 'issuer_identity_requires_review'}, {status: 409, headers});
    const audit = await readValuationAudit(versionId, identity.issuer.issuerId, {
      baseUrl: process.env.FILINGLENS_API_URL ?? '',
      token: process.env.FILINGLENS_VALUATION_READ_API_TOKEN ?? '', workspaceId: accountId,
    });
    if (audit.lineage.issuer.ticker?.toUpperCase() !== candidate.ticker.toUpperCase())
      throw new ProviderReadError('identity_mismatch');
    const root = audit.lineage.nodes[saved.valuation.method + ':implied_per_share'];
    if (!root || typeof root.value !== 'number' || root.value !== Number(saved.valuation.impliedValuePerShare) ||
      root.unit !== saved.valuation.currency + '/share')
      throw new ProviderReadError('identity_mismatch');
    return NextResponse.json({status: 'ready', audit}, {headers});
  } catch (error) {
    const reason = error instanceof ProviderReadError ? error.code : 'evidence_unavailable';
    return NextResponse.json({status: 'unavailable', reason}, {status: 503, headers});
  }
}
