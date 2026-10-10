import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { mappedRiskStudioWorkspace, readPortfolioExposure, readRiskRun,
  ProviderReadError } from '@/lib/integrations/external-readers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store' };

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  if (process.env.PORTFOLIO_RISK_READ_ENABLED !== 'true')
    return NextResponse.json({ status: 'disabled', reason: 'Risk Studio API integration not enabled' }, { headers });
  const url = new URL(req.url);
  const portfolioId = url.searchParams.get('portfolioId') ?? '';
  const runId = url.searchParams.get('runId');
  if (!/^[a-f0-9-]{36}$/i.test(portfolioId) || (runId && !/^[a-f0-9-]{36}$/i.test(runId)))
    return NextResponse.json({ error: 'Invalid portfolio/run reference' }, { status: 422, headers });
  try {
    // This map is configured by an administrator; a caller cannot supply workspaceId.
    const workspaceId = mappedRiskStudioWorkspace(session.auth.accountId, process.env.PORTFOLIO_RISK_WORKSPACE_MAP_JSON ?? '{}');
    if (!workspaceId)
      return NextResponse.json({ status: 'identity_unmapped', reason: 'No authorized portfolio workspace mapping' }, { status: 409, headers });
    const config = { baseUrl: process.env.PORTFOLIO_RISK_API_URL ?? '', token: process.env.PORTFOLIO_RISK_READ_API_TOKEN ?? '' };
    const exposure = await readPortfolioExposure(portfolioId, workspaceId, config);
    const riskRun = runId ? await readRiskRun(runId, portfolioId, workspaceId, config) : null;
    return NextResponse.json({ status: 'ready', exposure, riskRun }, { headers });
  } catch (e) {
    const code = e instanceof ProviderReadError ? e.code : 'read_unavailable';
    return NextResponse.json({ status: 'unavailable', reason: code }, { status: 503, headers });
  }
}
