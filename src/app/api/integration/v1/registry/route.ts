import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { loadWorkspace } from '@/lib/foundation/store';
import { resolveIssuer } from '@/lib/integrations/shared-contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    const workspace = await loadWorkspace(session.auth.userId);
    const issuers = workspace.candidates.map(candidate => ({
      candidateKey: candidate.key,
      identity: resolveIssuer(candidate),
    }));
    return NextResponse.json({ schemaVersion: 'issuer-registry.v1', issuers,
      note: 'Source links are not independent identity verification. Unmapped CVM records remain blocked.' },
      { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Issuer registry unavailable' },
      { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
