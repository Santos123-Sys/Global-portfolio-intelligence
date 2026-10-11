import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  return NextResponse.json({
    schemaVersion: 'integration-readiness.v1',
    scope: ['us', 'br'],
    gpi: { issuerRegistry: 'available', manualThesisReview: 'available',
      eventOutbox: 'persisted_delivery_disabled' },
    filingLens: { financialSnapshots: process.env.FILINGLENS_READ_ENABLED === 'true'
      ? 'read_attempts_enabled' : 'disabled', valuations: process.env.FILINGLENS_VALUATION_READ_API_TOKEN?'scoped_publisher_configured':'disabled',
      analysisRequests: process.env.INTEGRATION_SIGNING_SECRET?'human_workspace_handoff_available':'disabled' },
    portfolioRiskStudio: { portfolioExposures: process.env.PORTFOLIO_RISK_API_TOKEN?'account_snapshot_storage_available':'disabled',
      riskRuns: process.env.PORTFOLIO_RISK_API_TOKEN?'authenticated_calculation_configured':'disabled', outboundHandoffs: 'explicit_user_sharing',
      returns:'current_holdings_reconstruction',sectorCountryCoverage:'unclassified',fx:'unsupported' },
    trading: 'disabled',
  }, { headers: { 'cache-control': 'no-store' } });
}
