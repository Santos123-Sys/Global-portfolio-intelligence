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
      ? 'read_attempts_enabled' : 'disabled', valuations: 'awaiting_publisher',
      analysisRequests: 'awaiting_publisher' },
    portfolioRiskStudio: { portfolioExposures: 'awaiting_authenticated_provider',
      riskRuns: 'awaiting_authenticated_provider', outboundHandoffs: 'disabled' },
    trading: 'disabled',
  }, { headers: { 'cache-control': 'no-store' } });
}
