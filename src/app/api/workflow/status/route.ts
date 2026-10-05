import { NextResponse } from 'next/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { aiAnalyses, thesisVersions } from '@/lib/db/schema';
import { externalDiscoveryRuns } from '@/lib/db/workflow-schema';
import { resolveInvestmentWorkflow } from '@/lib/workflow-state';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;

  const [activeStrategy] = await db.select({
    id: thesisVersions.id,
    versionNumber: thesisVersions.versionNumber,
  }).from(thesisVersions).where(and(
    eq(thesisVersions.ownerId, session.auth.userId),
    isNull(thesisVersions.excludedAt),
    isNull(thesisVersions.supersededAt),
  )).orderBy(desc(thesisVersions.versionNumber)).limit(1);

  const [latestDiscovery] = activeStrategy
    ? await db.select({
        status: externalDiscoveryRuns.status,
        requestedAt: externalDiscoveryRuns.requestedAt,
      }).from(externalDiscoveryRuns).where(and(
        eq(externalDiscoveryRuns.ownerId, session.auth.userId),
        eq(externalDiscoveryRuns.thesisVersionId, activeStrategy.id),
      )).orderBy(desc(externalDiscoveryRuns.requestedAt)).limit(1)
    : [];

  const [acceptedResearch] = activeStrategy
    ? await db.select({ id: aiAnalyses.id }).from(aiAnalyses).where(and(
        eq(aiAnalyses.ownerId, session.auth.userId),
        eq(aiAnalyses.thesisVersionId, activeStrategy.id),
      )).orderBy(desc(aiAnalyses.analysisTimestamp)).limit(1)
    : [];

  const workflow = resolveInvestmentWorkflow({
    hasApprovedStrategy: Boolean(activeStrategy),
    approvedStrategyVersion: activeStrategy?.versionNumber ?? null,
    latestDiscoveryStatus: latestDiscovery?.status ?? null,
    hasAcceptedResearch: Boolean(acceptedResearch),
  });

  return NextResponse.json({ workflow }, { headers: { 'Cache-Control': 'no-store' } });
}
