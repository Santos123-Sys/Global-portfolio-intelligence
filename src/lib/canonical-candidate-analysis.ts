import { and, eq, isNull } from 'drizzle-orm';
import { analyzeSchema } from '@/lib/agent-finance/contracts';
import { queueAnalysisSession } from '@/lib/agent-finance/queue-session';
import { agentAnalysisSessions } from '@/lib/db/agent-schema';
import { db } from '@/lib/db';
import { priceHistory, securities, thesisVersions } from '@/lib/db/schema';
import { discoveryCandidates, externalDiscoveryRuns, securityRiskSnapshots } from '@/lib/db/workflow-schema';
import { getPriceProvider } from '@/lib/connectors';
import { computeStandaloneSecurityRisk } from '@/lib/quant/security-risk';
import { recordPriceObservation } from '@/lib/services/provenance';

/**
 * Prepare deterministic market evidence and enqueue the single canonical
 * Research Director session for an approved Discovery candidate.
 *
 * The generic agentic database is deliberately not touched here.
 */
export async function queueApprovedCandidateResearch(ownerId: string, candidateId: string) {
  const [row] = await db.select({
    candidate: discoveryCandidates,
    thesisVersionId: externalDiscoveryRuns.thesisVersionId,
  }).from(discoveryCandidates)
    .innerJoin(externalDiscoveryRuns, eq(discoveryCandidates.runId, externalDiscoveryRuns.id))
    .where(and(eq(discoveryCandidates.id, candidateId), eq(discoveryCandidates.ownerId, ownerId)))
    .limit(1);

  if (!row) throw new Error('Discovery candidate not found');
  if (row.candidate.analysisSessionId) throw new Error('This candidate already has a canonical research session');
  if (row.candidate.externalAnalysisRunId) throw new Error('This historical candidate already has a legacy analysis run');
  if (row.candidate.decision !== 'approved' || row.candidate.workflowStatus !== 'analysis_preparing') {
    throw new Error('Candidate research can start only after the market brief is approved');
  }
  if (!row.candidate.marketBriefJson || row.candidate.marketBriefStatus !== 'completed') {
    throw new Error('A completed approved market brief is required before financial research starts');
  }

  const [thesis] = await db.select({ id: thesisVersions.id }).from(thesisVersions).where(and(
    eq(thesisVersions.id, row.thesisVersionId),
    eq(thesisVersions.ownerId, ownerId),
    isNull(thesisVersions.excludedAt),
    isNull(thesisVersions.supersededAt)
  )).limit(1);
  if (!thesis) throw new Error('The thesis changed before candidate research was queued');

  const provider = getPriceProvider();
  if (provider.name === 'stub') throw new Error('Candidate analysis refuses stub market data; configure EODHD first');
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 550 * 86_400_000).toISOString().slice(0, 10);
  const bars = await provider.getDailyBars(row.candidate.ticker, row.candidate.exchange, from, to);
  if (bars.length < 31) throw new Error(`Provider supplied only ${bars.length} price observations; at least 31 are required for risk analysis`);

  const [security] = await db.insert(securities).values({
    ticker: row.candidate.ticker,
    companyName: row.candidate.companyName,
    exchange: row.candidate.exchange,
    currency: row.candidate.currency,
    sector: row.candidate.sector,
    industry: row.candidate.industry,
    country: row.candidate.country,
  }).onConflictDoUpdate({
    target: [securities.ticker, securities.exchange],
    set: {
      companyName: row.candidate.companyName,
      currency: row.candidate.currency,
      sector: row.candidate.sector,
      industry: row.candidate.industry,
      country: row.candidate.country,
    },
  }).returning();

  await db.insert(priceHistory).values(bars.map((bar) => ({
    securityId: security.id,
    priceDate: bar.date,
    close: String(bar.close),
    volume: bar.volume != null ? String(bar.volume) : null,
    currency: bar.currency,
    source: provider.name,
  }))).onConflictDoNothing();
  await recordPriceObservation(security.id, bars.at(-1)!, provider.name);

  const risk = computeStandaloneSecurityRisk(bars);
  const dataAsOf = new Date(risk[0].dataAsOf);
  await db.delete(securityRiskSnapshots).where(and(
    eq(securityRiskSnapshots.ownerId, ownerId),
    eq(securityRiskSnapshots.candidateId, candidateId)
  ));
  await db.insert(securityRiskSnapshots).values({
    ownerId,
    candidateId,
    securityId: security.id,
    metricsJson: risk,
    provider: provider.name,
    dataAsOf,
  });

  const request = analyzeSchema.parse({
    ticker: security.ticker,
    analysisType: 'combined',
    portfolioId: row.candidate.portfolioId,
    thesisVersionId: row.thesisVersionId,
  });
  const session = await queueAnalysisSession({
    ownerId,
    securityId: security.id,
    request,
    origin: 'discovery_candidate',
  });

  const [candidate] = await db.update(discoveryCandidates).set({
    securityId: security.id,
    workflowStatus: 'analysis_queued',
    analysisSessionId: session.id,
    analysisErrorMessage: null,
    updatedAt: new Date(),
  }).where(and(
    eq(discoveryCandidates.id, candidateId),
    eq(discoveryCandidates.ownerId, ownerId),
    eq(discoveryCandidates.workflowStatus, 'analysis_preparing'),
    isNull(discoveryCandidates.analysisSessionId),
    isNull(discoveryCandidates.externalAnalysisRunId)
  )).returning();

  if (!candidate) {
    // The queue record must not continue if another request won the candidate
    // transition. Preserve auditability instead of deleting the session.
    await db.update(agentAnalysisSessions).set({
      status: 'cancelled',
      phase: 'cancelled',
      error: 'Candidate state changed before this session could be attached.',
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(agentAnalysisSessions.id, session.id), eq(agentAnalysisSessions.status, 'queued')));
    throw new Error('Candidate analysis state changed before the canonical session could be attached');
  }

  return { candidate, session, risk };
}
