import { randomUUID } from 'node:crypto';
import { getEnv } from './env';
import { sql, and, or, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import {
  AgenticRunRequest,
  DiscoveryCandidate,
  issuerKey,
  listingKey,
  screenDiscoveryUniverse,
  DiscoveryRunRequest,
  MarketDiscoveryOutput,
  PortfolioRole,
  ThesisCriteria,
  validateDiscoveryOutput,
  validateRunRequestCoherence,
  type DiscoveryRunStatus,
  type GroundingBundle,
} from '@portfolio-intelligence/agentic-contract';
import { getActiveAgentCustomization } from './agent-config';
import { decisionJournalAuditText, type DecisionJournal } from './decision-journal';
import { getPriceProvider } from './connectors';
import { enrichDiscoveryIssuerSources, loadDiscoveryUniverse } from './discovery-provider';
import { db } from './db';
import { accounts, aiAnalyses, decisionLog, portfolios, positions, priceHistory, securities, thesisVersions } from './db/schema';
import {
  discoveryCandidates,
  externalAgenticRuns,
  externalDiscoveryRuns,
  securityRiskSnapshots,
} from './db/workflow-schema';
import { startExternalAgenticRun, startExternalDiscoveryRun, fetchExternalDiscoveryRun } from './integrations/agentic-client';
import { computeStandaloneSecurityRisk } from './quant/security-risk';
import { recordPriceObservation } from './services/provenance';
import { isUnspecifiedThesisMandateCurrency, normalizeThesisMandateCurrency } from './thesis-currency';

const ROLE_EXCHANGE: Partial<Record<PortfolioRole, string>> = {
  swiss_quality: 'XSWX',
  brazilian_growth: 'BVMF',
};

function uniqueBy<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const value = key(row);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

type CandidateIdentity = {
  portfolioId: string;
  exchange: string;
  ticker: string;
};

/**
 * A rejection is a user decision, not a transient visual state. Keep it from
 * being rediscovered for the same portfolio and security identity on a later
 * run. The original record remains in Research history for auditability.
 */
export function candidateIdentityKey(candidate: CandidateIdentity): string {
  return [candidate.portfolioId, candidate.exchange.trim().toUpperCase(), candidate.ticker.trim().toUpperCase()].join('::');
}

/** Listing deduplication is scoped to the investor's portfolio. */
export function deduplicateDiscoveryCandidates<T extends CandidateIdentity>(candidates: T[]): T[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidateIdentityKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function excludePreviouslyRejectedCandidates<T extends CandidateIdentity>(
  candidates: T[],
  previouslyRejected: Iterable<CandidateIdentity>
): T[] {
  const rejectedKeys = new Set(Array.from(previouslyRejected, candidateIdentityKey));
  return candidates.filter((candidate) => !rejectedKeys.has(candidateIdentityKey(candidate)));
}

export async function buildDiscoveryRunRequest(
  ownerId: string,
  maxCandidatesPerPortfolio = 8,
  thesisVersionId?: string
): Promise<{ request: DiscoveryRunRequest; provider: string; thesisVersionId: string }> {
  const thesisFilters = [
    eq(thesisVersions.ownerId, ownerId),
    isNull(thesisVersions.excludedAt),
    isNull(thesisVersions.supersededAt),
  ];
  if (thesisVersionId) thesisFilters.push(eq(thesisVersions.id, thesisVersionId));
  const [thesis, ownerPortfolios, agentConfig] = await Promise.all([
    db.select().from(thesisVersions).where(and(...thesisFilters))
      .orderBy(desc(thesisVersions.versionNumber)).limit(1).then((rows) => rows[0]),
    db.select().from(portfolios).where(eq(portfolios.ownerId, ownerId)),
    getActiveAgentCustomization(ownerId, 'market_research'),
  ]);
  if (!thesis) throw new Error('Confirm an investment thesis before starting stock discovery');
  const criteria = ThesisCriteria.parse(thesis.criteriaJson);
  if (criteria.version !== thesis.versionNumber) throw new Error('Confirmed thesis version is inconsistent');

  const criteriaByRole = new Map<PortfolioRole, ThesisCriteria['portfolios'][number]>();
  for (const mandate of criteria.portfolios) {
    const supportedRole = PortfolioRole.safeParse(mandate.role);
    // Preserve broader mandates in the thesis and portfolio records, while
    // only dispatching roles for which a provider universe is configured.
    if (!supportedRole.success) continue;
    if (criteriaByRole.has(supportedRole.data)) {
      throw new Error(`Confirmed thesis contains duplicate ${mandate.role} mandates`);
    }
    criteriaByRole.set(supportedRole.data, mandate);
  }

  const equityPortfolios = ownerPortfolios.flatMap((portfolio) => {
    const role = PortfolioRole.safeParse(portfolio.portfolioType);
    if (!role.success || !ROLE_EXCHANGE[role.data]) return [];
    const mandate = criteriaByRole.get(role.data);
    if (!mandate) return [];
    const thesisCurrency = normalizeThesisMandateCurrency(mandate.currency);
    if (
      !isUnspecifiedThesisMandateCurrency(thesisCurrency) &&
      thesisCurrency !== portfolio.baseCurrency.toUpperCase()
    ) {
      throw new Error(
        `${portfolio.name} uses ${portfolio.baseCurrency}, but the confirmed ${role.data} thesis mandate specifies ${thesisCurrency}`
      );
    }
    return [{
      id: portfolio.id,
      name: portfolio.name,
      role: role.data as Exclude<PortfolioRole, 'not_suitable'>,
      baseCurrency: portfolio.baseCurrency,
      investmentObjective: portfolio.investmentObjective ?? '',
    }];
  });
  if (!equityPortfolios.length) {
    throw new Error('This thesis was confirmed, but none of its portfolio mandates has a configured equity-discovery market yet');
  }

  const exchanges = [...new Set(equityPortfolios.map((portfolio) => ROLE_EXCHANGE[portfolio.role]!))];
  // Provider lists are capped before screening; dated seed supplements may
  // expand them. Report this bounded coverage instead of claiming a full market.
  const attempts = await Promise.allSettled(exchanges.map((exchange) => loadDiscoveryUniverse(exchange, getEnv().DISCOVERY_UNIVERSE_LIMIT)));
  const universeFailures = attempts.flatMap((result, i) => result.status === 'rejected'
    ? [{ exchange: exchanges[i], reason: 'Market universe could not be retrieved; check provider access and retry.' }] : []);
  const loaded = attempts.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  const batches = loaded.map((result) => result.records);
  const universe = uniqueBy(batches.flat(), (record) => `${record.exchange}:${record.ticker}`);
  if (!universe.length) throw new Error('The configured market-data provider returned an empty security universe');

  const [held, prior] = await Promise.all([
    db.select({ portfolioId: positions.portfolioId, ticker: securities.ticker, exchange: securities.exchange })
      .from(positions).innerJoin(portfolios, eq(positions.portfolioId, portfolios.id))
      .innerJoin(securities, eq(positions.securityId, securities.id))
      .where(and(eq(portfolios.ownerId, ownerId), sql`${positions.quantity} <> 0`)),
    db.select({ portfolioId: discoveryCandidates.portfolioId, ticker: discoveryCandidates.ticker, exchange: discoveryCandidates.exchange,
      decision: discoveryCandidates.decision, thesisVersionId: externalDiscoveryRuns.thesisVersionId, discoveryJson: discoveryCandidates.discoveryJson })
      .from(discoveryCandidates).innerJoin(externalDiscoveryRuns, eq(discoveryCandidates.runId, externalDiscoveryRuns.id))
      .innerJoin(thesisVersions, eq(externalDiscoveryRuns.thesisVersionId, thesisVersions.id))
      .where(and(eq(discoveryCandidates.ownerId, ownerId), isNull(thesisVersions.excludedAt),
        or(eq(discoveryCandidates.decision, 'approved'), eq(externalDiscoveryRuns.thesisVersionId, thesis.id)))),
  ]);
  const knownSecurities: NonNullable<DiscoveryRunRequest['knownSecurities']> = [
    ...held.map(row => ({ ...row, issuerKey: undefined as string | undefined, reason: 'held' as const })),
    ...prior.filter(row => row.decision === 'approved' || row.thesisVersionId === thesis.id).map(row => ({
      portfolioId: row.portfolioId, ticker: row.ticker, exchange: row.exchange, thesisVersionId: row.thesisVersionId,
      issuerKey: DiscoveryCandidate.safeParse(row.discoveryJson).data?.discoveryContext?.issuerKey,
      reason: row.decision === 'rejected' ? 'rejected' as const : row.decision === 'approved' ? 'under_analysis' as const : 'under_review' as const,
    })),
  ].map(row => ({ ...row, issuerKey: row.issuerKey ?? (() => {
    const record = universe.find(record => listingKey(record) === listingKey(row));
    return record ? issuerKey(record) : undefined;
  })() }));
  const request = DiscoveryRunRequest.parse({
    thesis: { versionId: thesis.id, criteria },
    portfolios: equityPortfolios,
    universe,
    maxCandidatesPerPortfolio,
    researchBudgetPerPortfolio: getEnv().DISCOVERY_RESEARCH_BUDGET,
    knownSecurities,
    universeFailures,
    agentConfig,
  });
  return { request, provider: [...new Set(loaded.map((result) => `${result.provider}${result.cached ? ':cached' : ''}`))].join(', '), thesisVersionId: thesis.id };
}

export async function preflightDiscoveryForOwner(ownerId: string, maxCandidatesPerPortfolio = 6) {
  try {
    const built = await buildDiscoveryRunRequest(ownerId, maxCandidatesPerPortfolio);
    const universeByExchange = new Map<string, number>();
    for (const record of built.request.universe) {
      universeByExchange.set(record.exchange, (universeByExchange.get(record.exchange) ?? 0) + 1);
    }
    return {
      ready: true as const,
      checkedAt: new Date().toISOString(),
      provider: built.provider,
      thesisVersionId: built.thesisVersionId,
      checks: [
        ...(built.request.universeFailures ?? []).map(f => ({ label: `${f.exchange} unavailable`, status: 'warning' as const, detail: `${f.reason} Other available portfolios can still run.` })),
        { label: 'Confirmed thesis', detail: `Version ${built.request.thesis.criteria.version} is active`, status: 'ready' as const },
        { label: 'Portfolio mandates', detail: `${built.request.portfolios.length} eligible portfolio${built.request.portfolios.length === 1 ? '' : 's'} aligned to the thesis`, status: 'ready' as const },
        ...[...universeByExchange.entries()].map(([exchange, count]) => ({
          label: exchange === 'BVMF' ? 'Brazilian B3 universe' : exchange === 'XSWX' ? 'Swiss SIX universe' : `${exchange} universe`,
          detail: `${count} tradable securities available for research`,
          status: 'ready' as const,
        })),
      ],
    };
  } catch (error) {
    return {
      ready: false as const,
      checkedAt: new Date().toISOString(),
      provider: null,
      thesisVersionId: null,
      checks: [{
        label: 'Discovery readiness',
        detail: error instanceof Error ? error.message : 'Unknown discovery preflight failure',
        status: 'blocked' as const,
      }],
    };
  }
}

export async function startDiscoveryRunForOwner(input: {
  ownerId: string;
  maxCandidatesPerPortfolio?: number;
  thesisVersionId?: string;
  reuseExistingForThesis?: boolean;
}) {

  const built = await buildDiscoveryRunRequest(
    input.ownerId,
    input.maxCandidatesPerPortfolio ?? 6,
    input.thesisVersionId
  );
  const screened = screenDiscoveryUniverse(built.request);
  const selected = new Set([...screened.eligibleByPortfolio.values()].flat().map(record => listingKey(record)));
  const selectedRecords = built.request.universe.filter(record => selected.has(listingKey(record)));
  const profiles = await enrichDiscoveryIssuerSources(selectedRecords);
  const byListing = new Map(profiles.map(record => [listingKey(record), record]));
  built.request = DiscoveryRunRequest.parse({ ...built.request,
    universe: built.request.universe.map(record => byListing.get(listingKey(record)) ?? record) });
  // Serialize against confirmation/exclusion. Recheck after provider loading, just
  // before dispatch; a previously loaded mandate must not start after supersession.
  const dispatched = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.ownerId}))`);
    const [active] = await tx.select().from(thesisVersions).where(and(
      eq(thesisVersions.id, built.thesisVersionId), eq(thesisVersions.ownerId, input.ownerId),
      isNull(thesisVersions.excludedAt), isNull(thesisVersions.supersededAt)
    )).limit(1);
    if (!active) throw new Error('The thesis changed before Discovery started. Review the active version and retry.');
    {
      const [existing] = await tx.select().from(externalDiscoveryRuns).where(and(
        eq(externalDiscoveryRuns.ownerId, input.ownerId), eq(externalDiscoveryRuns.thesisVersionId, built.thesisVersionId)
      )).orderBy(desc(externalDiscoveryRuns.requestedAt)).limit(1);
      if (existing && (existing.status === 'dispatching' || (input.reuseExistingForThesis && existing.status !== 'failed'))) return { run: existing, remote: null, reused: true as const };
    }
    const dispatchId = randomUUID();
    const request = DiscoveryRunRequest.parse({ ...built.request, dispatchId });
    const [created] = await tx.insert(externalDiscoveryRuns).values({
      ownerId: input.ownerId, thesisVersionId: built.thesisVersionId,
      externalDiscoveryId: `discovery_${dispatchId}`, status: 'dispatching',
      provider: built.provider, requestJson: request,
    }).returning();
    return { run: created, remote: null, reused: false as const };
  });
  if (dispatched.run.status === 'dispatching') {
    const run = await recoverDiscoveryDispatch(dispatched.run.id, input.ownerId);
    return { ...dispatched, run };
  }
  return dispatched;
}

/** The durable row exists before HTTP; repeat delivery always uses its immutable ID. */
export async function recoverDiscoveryDispatch(runId: string, ownerId: string) {
  const sent = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ownerId}))`);
    const [run] = await tx.select().from(externalDiscoveryRuns).where(and(
      eq(externalDiscoveryRuns.id, runId), eq(externalDiscoveryRuns.ownerId, ownerId)
    )).limit(1);
    if (!run) throw new Error('Discovery run not found');
    if (run.status !== 'dispatching') return { run, remote: null };
    const [active] = await tx.select().from(thesisVersions).where(and(
      eq(thesisVersions.id, run.thesisVersionId), eq(thesisVersions.ownerId, ownerId),
      isNull(thesisVersions.excludedAt), isNull(thesisVersions.supersededAt)
    )).limit(1);
    try {
      // A superseded intent must never create new work. Its stable ID still
      // lets us reconcile work accepted before the thesis changed.
      const remote = active
        ? await startExternalDiscoveryRun(DiscoveryRunRequest.parse(run.requestJson))
        : await fetchExternalDiscoveryRun(run.externalDiscoveryId);
      if (remote.externalDiscoveryId !== run.externalDiscoveryId) throw new Error('Dispatch identity changed');
      // Leave the intent pending until synchronize commits status AND result.
      // A crash here must remain retryable, including terminal remote results.
      return { run, remote };
    } catch (error) {
      const rejected = error instanceof Error && /returned (400|409)/.test(error.message);
      const notFound = !active && error instanceof Error && /returned 404/.test(error.message);
      const [updated] = await tx.update(externalDiscoveryRuns).set({
        status: notFound || rejected ? 'failed' : 'dispatching',
        errorMessage: rejected ? 'The service rejected this saved request. Check deployment compatibility and request validation before starting another run.' : notFound ? 'Thesis changed before dispatch; start a new Discovery run.' : 'Delivery is unconfirmed. Automatic reconciliation will reuse the saved request; no new run is needed.',
        completedAt: notFound || rejected ? new Date() : null,
      }).where(eq(externalDiscoveryRuns.id, run.id)).returning();
      return { run: updated, remote: null };
    }
  });
  return sent.remote ? synchronizeDiscoveryRun(sent.run.id, ownerId, sent.remote) : sent.run;
}

/** Invoked by authenticated cron as well as normal owner polling. */
export async function reconcilePendingDiscoveryDispatches() {
  const pending = eq(externalDiscoveryRuns.status, 'dispatching');
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(externalDiscoveryRuns).where(pending);
  if (!total) return { considered: 0, recovered: 0 };
  // Move the bounded window each day, so permanently unavailable old intents
  // cannot starve newer owners in the scheduled reconciliation.
  const start = (Math.floor(Date.now() / 86_400_000) * 10) % total;
  const read = (offset: number, limit: number) => db.select({ id: externalDiscoveryRuns.id, ownerId: externalDiscoveryRuns.ownerId })
    .from(externalDiscoveryRuns).where(pending).orderBy(externalDiscoveryRuns.requestedAt, externalDiscoveryRuns.id).limit(limit).offset(offset);
  const rows = await read(start, 10);
  if (rows.length < 10 && start > 0) rows.push(...await read(0, 10 - rows.length));
  let recovered = 0;
  for (const row of rows) {
    try { if ((await recoverDiscoveryDispatch(row.id, row.ownerId)).status !== 'dispatching') recovered++; }
    catch { /* durable intent remains available for the next cycle */ }
  }
  return { considered: rows.length, recovered };
}

export async function synchronizeDiscoveryRun(
  localRunId: string,
  ownerId: string,
  remote: DiscoveryRunStatus
) {
  const [local] = await db.select().from(externalDiscoveryRuns).where(and(
    eq(externalDiscoveryRuns.id, localRunId),
    eq(externalDiscoveryRuns.ownerId, ownerId)
  )).limit(1);
  if (!local) throw new Error('Discovery run not found');
  if (local.externalDiscoveryId !== remote.externalDiscoveryId) throw new Error('Discovery identity changed');
  const [usableThesis] = await db.select({ id: thesisVersions.id }).from(thesisVersions).where(and(
    eq(thesisVersions.id, local.thesisVersionId),
    eq(thesisVersions.ownerId, ownerId),
    isNull(thesisVersions.excludedAt)
  )).limit(1);
  if (!usableThesis) {
    const [updated] = await db.update(externalDiscoveryRuns).set({
      status: 'failed',
      errorMessage: 'The associated thesis version was excluded',
      completedAt: new Date(),
    }).where(eq(externalDiscoveryRuns.id, local.id)).returning();
    return updated;
  }

  if (remote.status !== 'completed') {
    const [updated] = await db.update(externalDiscoveryRuns).set({
      status: remote.status,
      errorMessage: remote.errorMessage,
      completedAt: remote.status === 'failed' ? new Date() : local.completedAt,
    }).where(eq(externalDiscoveryRuns.id, local.id)).returning();
    return updated;
  }
  if (!remote.result) throw new Error('Completed discovery is missing its result');
  const request = DiscoveryRunRequest.parse(local.requestJson);
  const parsedResult = MarketDiscoveryOutput.parse(remote.result);
  const result = MarketDiscoveryOutput.parse({
    ...parsedResult,
    candidates: deduplicateDiscoveryCandidates(parsedResult.candidates),
  });
  validateDiscoveryOutput(result, request);

  return db.transaction(async (tx) => {
    const [updated] = await tx.update(externalDiscoveryRuns).set({
      status: 'completed',
      resultJson: result,
      errorMessage: null,
      completedAt: new Date(),
    }).where(eq(externalDiscoveryRuns.id, local.id)).returning();
    const portfolioIds = [...new Set(result.candidates.map((candidate) => candidate.portfolioId))];
    const priorRejected = portfolioIds.length
      ? await tx.select({
        portfolioId: discoveryCandidates.portfolioId,
        exchange: discoveryCandidates.exchange,
        ticker: discoveryCandidates.ticker,
      }).from(discoveryCandidates)
        .innerJoin(externalDiscoveryRuns, eq(discoveryCandidates.runId, externalDiscoveryRuns.id)).where(and(
        eq(externalDiscoveryRuns.thesisVersionId, local.thesisVersionId),
        eq(discoveryCandidates.ownerId, ownerId),
        eq(discoveryCandidates.decision, 'rejected'),
        inArray(discoveryCandidates.portfolioId, portfolioIds),
        ne(discoveryCandidates.runId, local.id)
      ))
      : [];
    const candidatesToPersist = excludePreviouslyRejectedCandidates(result.candidates, priorRejected);

    for (const candidate of candidatesToPersist) {
      await tx.insert(discoveryCandidates).values({
        ownerId,
        runId: local.id,
        portfolioId: candidate.portfolioId,
        ticker: candidate.ticker,
        exchange: candidate.exchange,
        companyName: candidate.companyName,
        currency: candidate.currency,
        country: candidate.country,
        sector: candidate.sector,
        industry: candidate.industry,
        classificationSource: candidate.classificationSource,
        discoveryJson: candidate,
      }).onConflictDoNothing();
    }
    return updated;
  });
}

async function ownedCandidate(ownerId: string, candidateId: string) {
  const [row] = await db.select({
    candidate: discoveryCandidates,
    portfolio: portfolios,
    run: externalDiscoveryRuns,
  }).from(discoveryCandidates)
    .innerJoin(portfolios, eq(discoveryCandidates.portfolioId, portfolios.id))
    .innerJoin(externalDiscoveryRuns, eq(discoveryCandidates.runId, externalDiscoveryRuns.id))
    .innerJoin(thesisVersions, eq(externalDiscoveryRuns.thesisVersionId, thesisVersions.id))
    .where(and(
      eq(discoveryCandidates.id, candidateId),
      eq(discoveryCandidates.ownerId, ownerId),
      isNull(thesisVersions.excludedAt)
    ))
    .limit(1);
  return row ?? null;
}

export async function rejectOrWatchCandidate(
  ownerId: string,
  candidateId: string,
  decision: 'rejected' | 'watchlist',
  journal: DecisionJournal | undefined
) {
  const row = await ownedCandidate(ownerId, candidateId);
  if (!row) throw new Error('Discovery candidate not found');
  if (row.candidate.decision === 'approved') throw new Error('An approved candidate cannot be downgraded while its analysis is active');
  const rationale = journal?.decisionReason;
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(discoveryCandidates).set({
      decision,
      rationale,
      decisionJournal: journal,
      decidedAt: new Date(),
      workflowStatus: decision,
      updatedAt: new Date(),
    }).where(eq(discoveryCandidates.id, candidateId)).returning();
    await tx.insert(decisionLog).values({
      ownerId,
      title: `${row.candidate.companyName} (${row.candidate.ticker}) — ${decision}`,
      decision,
      reasoning: rationale ?? null,
      alternativesConsidered: journal ? decisionJournalAuditText(journal) : null,
      outcome: decision === 'rejected' ? 'Excluded from new discovery outputs for this portfolio under this thesis version; a new thesis may reconsider it.' : 'Kept for later review.',
      relatedPortfolioId: row.portfolio.id,
      metadata: {
        thesisVersionId: row.run.thesisVersionId,
        evidenceAsOf: row.candidate.updatedAt.toISOString(),
        journalVersion: journal ? 1 : undefined,
      },
    });
    return updated;
  });
}

/**
 * Persist the human decision before any market-data or agentic call. Approval
 * is a durable workflow transition; it must not disappear merely because an
 * external provider is slow or unavailable after the user clicks the button.
 * An approved candidate whose preparation failed can re-enter this state, but
 * a candidate with an external run must use the external-run retry path.
 */
export async function approveCandidateForAnalysis(ownerId: string, candidateId: string, decidedBy: string, journal: DecisionJournal) {
  const row = await ownedCandidate(ownerId, candidateId);
  if (!row) throw new Error('Discovery candidate not found');
  if (row.candidate.externalAnalysisRunId) throw new Error('This candidate already has an analysis run; use Retry analysis if it failed');
  const retryingPreparation = row.candidate.decision === 'approved' && row.candidate.workflowStatus === 'analysis_failed';
  if (row.candidate.decision !== 'pending' && row.candidate.decision !== 'watchlist' && !retryingPreparation) {
    throw new Error('Only pending or watchlist candidates can be approved');
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ownerId}))`);
    const [active] = await tx.select({ id: thesisVersions.id }).from(thesisVersions).where(and(
      eq(thesisVersions.id, row.run.thesisVersionId), eq(thesisVersions.ownerId, ownerId),
      isNull(thesisVersions.excludedAt), isNull(thesisVersions.supersededAt)
    )).limit(1);
    if (!active) throw new Error('The thesis has changed. Run Discovery under the current approved thesis before approving this candidate.');
    const [candidate] = await tx.update(discoveryCandidates).set({
      decision: 'approved',
      rationale: journal.decisionReason,
      decisionJournal: journal,
      decidedAt: row.candidate.decidedAt ?? new Date(),
      workflowStatus: 'analysis_preparing',
      analysisErrorMessage: null,
      updatedAt: new Date(),
    }).where(and(
      eq(discoveryCandidates.id, candidateId),
      eq(discoveryCandidates.ownerId, ownerId),
      eq(discoveryCandidates.decision, row.candidate.decision),
      eq(discoveryCandidates.workflowStatus, row.candidate.workflowStatus),
      isNull(discoveryCandidates.externalAnalysisRunId)
    )).returning();
    if (!candidate) throw new Error('Candidate approval changed concurrently; refresh before trying again');
    await tx.insert(decisionLog).values({
      ownerId,
      title: `${row.candidate.companyName} (${row.candidate.ticker}) — approved for analysis`,
      decision: 'approved',
      reasoning: journal.decisionReason,
      alternativesConsidered: decisionJournalAuditText(journal),
      outcome: 'Financial analysis and valuation preparation requested.',
      relatedPortfolioId: row.portfolio.id,
      metadata: {
        thesisVersionId: row.run.thesisVersionId,
        evidenceAsOf: row.candidate.updatedAt.toISOString(),
        journalVersion: 1,
      },
    });
    return { candidate };
  });
}

/** Complete the slow provider and agentic handoff after approval is visible. */
export async function startApprovedCandidateAnalysis(
  ownerId: string,
  candidateId: string
) {
  const row = await ownedCandidate(ownerId, candidateId);
  if (!row) throw new Error('Discovery candidate not found');
  if (row.candidate.externalAnalysisRunId) throw new Error('This candidate already has an analysis run');
  if (row.candidate.decision !== 'approved' || row.candidate.workflowStatus !== 'analysis_preparing') {
    throw new Error('Candidate analysis can start only from the analysis_preparing state');
  }

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
    currency: bar.currency,
    source: provider.name,
  }))).onConflictDoNothing();
  await recordPriceObservation(security.id, bars.at(-1)!, provider.name);

  const risk = computeStandaloneSecurityRisk(bars);
  const dataAsOf = new Date(risk[0].dataAsOf);
  // Preparation can be retried after a provider or agentic-service failure.
  // Replace the deterministic snapshot instead of accumulating duplicates.
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

  const discoveryEvidence = DiscoveryCandidate.parse(row.candidate.discoveryJson);
  const researchEvidence: NonNullable<GroundingBundle['researchEvidence']> = {
    [`research:rationale:${candidateId}`]: discoveryEvidence.rationale,
    [`research:discovery_handoff:${candidateId}`]: JSON.stringify({
      discoveryRunId: row.run.id, thesisVersionId: row.run.thesisVersionId,
      portfolioId: row.portfolio.id, reportingCurrency: row.portfolio.baseCurrency,
      identity: { ticker: row.candidate.ticker, exchange: row.candidate.exchange, tradingCurrency: row.candidate.currency },
      context: discoveryEvidence.discoveryContext ?? null,
      unresolvedQuestions: discoveryEvidence.informationGaps,
    }),
    [`research:matched_criteria:${candidateId}`]: discoveryEvidence.matchedCriteria.join(' | ') || 'None evidenced',
    [`research:violated_criteria:${candidateId}`]: discoveryEvidence.violatedCriteria.join(' | ') || 'None evidenced',
    [`research:information_gaps:${candidateId}`]: discoveryEvidence.informationGaps.join(' | ') || 'None recorded',
    [`research:source_urls:${candidateId}`]: discoveryEvidence.sourceUrls.join(' | '),
  };
  const computedMetrics: GroundingBundle['computedMetrics'] = {};
  for (const metric of risk) computedMetrics[`securityRiskMetric:${metric.metricName}:${metric.computedAt}`] = metric.value;
  computedMetrics[`marketPrice:close:${bars.at(-1)!.date}`] = bars.at(-1)!.close;
  const bundle: GroundingBundle = {
    ticker: security.ticker,
    companyName: security.companyName,
    exchange: security.exchange,
    currency: security.currency,
    sector: security.sector,
    country: security.country,
    computedMetrics,
    fundamentals: {},
    analysisMode: 'limited_research_risk',
    researchEvidence,
    dataAsOf: new Date(Math.max(dataAsOf.getTime(), Date.parse(`${bars.at(-1)!.date}T00:00:00.000Z`))).toISOString(),
  };

  const [thesisVersion] = await db.select().from(thesisVersions)
    .where(and(
      eq(thesisVersions.id, row.run.thesisVersionId),
      eq(thesisVersions.ownerId, ownerId),
      isNull(thesisVersions.excludedAt)
    )).limit(1);
  if (!thesisVersion) throw new Error('The candidate thesis version has been excluded');
  const thesis = ThesisCriteria.parse(thesisVersion.criteriaJson);
  const [securityConfig, synthesisConfig] = await Promise.all([
    getActiveAgentCustomization(ownerId, 'security_analysis'),
    getActiveAgentCustomization(ownerId, 'portfolio_synthesis'),
  ]);
  const [account] = await db.select({ id: accounts.id }).from(accounts)
    .where(eq(accounts.ownerUserId, ownerId)).limit(1);
  if (!account) throw new Error('No account is available for this candidate analysis');
  const request = AgenticRunRequest.parse({
    accountId: account.id,
    thesis: { versionId: row.run.thesisVersionId, criteria: thesis },
    securities: [{ ticker: security.ticker, exchange: security.exchange, portfolioId: row.portfolio.id }],
    portfolios: [{
      id: row.portfolio.id,
      name: row.portfolio.name,
      baseCurrency: row.portfolio.baseCurrency,
      investmentObjective: row.portfolio.investmentObjective ?? '',
    }],
    groundingBundles: [{ portfolioId: row.portfolio.id, bundle }],
    origin: { kind: 'discovery_candidate', candidateId },
    agentConfigs: [securityConfig, synthesisConfig],
  });
  validateRunRequestCoherence(request);
  const remote = await startExternalAgenticRun(request);
  const [run] = await db.insert(externalAgenticRuns).values({
    ownerId,
    accountId: account.id,
    externalRunId: remote.externalRunId,
    status: remote.status,
    thesisVersion: String(thesis.version),
    reportPdfUrl: remote.reportPdfUrl,
    errorMessage: remote.errorMessage,
    requestJson: request,
  }).returning();
  const [candidate] = await db.update(discoveryCandidates).set({
    securityId: security.id,
    workflowStatus: 'analysis_queued',
    externalAnalysisRunId: remote.externalRunId,
    analysisErrorMessage: null,
    updatedAt: new Date(),
  }).where(and(
    eq(discoveryCandidates.id, candidateId),
    eq(discoveryCandidates.ownerId, ownerId),
    eq(discoveryCandidates.workflowStatus, 'analysis_preparing'),
    isNull(discoveryCandidates.externalAnalysisRunId)
  )).returning();
  if (!candidate) throw new Error('Candidate analysis state changed before the run could be attached');
  return { candidate, run, remote, risk };
}

export async function failCandidateAnalysisPreparation(ownerId: string, candidateId: string, error: unknown) {
  const message = (error instanceof Error ? error.message : 'Unknown analysis preparation failure').slice(0, 2_000);
  const [candidate] = await db.update(discoveryCandidates).set({
    workflowStatus: 'analysis_failed',
    analysisErrorMessage: message,
    updatedAt: new Date(),
  }).where(and(
    eq(discoveryCandidates.id, candidateId),
    eq(discoveryCandidates.ownerId, ownerId),
    eq(discoveryCandidates.workflowStatus, 'analysis_preparing'),
    isNull(discoveryCandidates.externalAnalysisRunId)
  )).returning();
  return candidate ?? null;
}

export async function candidateAnalysisIds(runIds: string[]) {
  if (!runIds.length) return new Map<string, string>();
  const rows = await db.select({
    externalRunId: externalAgenticRuns.externalRunId,
    analysisId: aiAnalyses.id,
  }).from(externalAgenticRuns)
    .innerJoin(aiAnalyses, eq(aiAnalyses.externalRunId, externalAgenticRuns.id))
    .where(inArray(externalAgenticRuns.externalRunId, runIds));
  return new Map(rows.map((row) => [row.externalRunId, row.analysisId]));
}
