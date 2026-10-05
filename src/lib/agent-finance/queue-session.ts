import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentAnalysisSessions, agentSessionEvents } from '@/lib/db/agent-schema';
import { analyzeSchema, type AnalyzeRequest } from './contracts';

export const MAX_ACTIVE_ANALYSIS_SESSIONS = 3;

export class AnalysisQueueCapacityError extends Error {
  constructor() {
    super(`${MAX_ACTIVE_ANALYSIS_SESSIONS} analyses are already active; wait before starting another.`);
    this.name = 'AnalysisQueueCapacityError';
  }
}

/**
 * The only write boundary for new security-analysis work.
 *
 * HTTP analysis requests and Discovery handoffs both persist the exact same
 * canonical session contract. The Railway finance runtime then claims the
 * session and the Research Director owns all downstream orchestration.
 */
export async function queueAnalysisSession(input: {
  ownerId: string;
  securityId: string;
  request: AnalyzeRequest;
  origin?: 'direct' | 'discovery_candidate';
}) {
  const request = analyzeSchema.parse(input.request);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.ownerId}, 0))`);
    const active = await tx.select({ id: agentAnalysisSessions.id })
      .from(agentAnalysisSessions)
      .where(and(
        eq(agentAnalysisSessions.ownerId, input.ownerId),
        inArray(agentAnalysisSessions.status, ['queued', 'running'])
      ))
      .limit(MAX_ACTIVE_ANALYSIS_SESSIONS);
    if (active.length >= MAX_ACTIVE_ANALYSIS_SESSIONS) throw new AnalysisQueueCapacityError();

    const [created] = await tx.insert(agentAnalysisSessions).values({
      ownerId: input.ownerId,
      securityId: input.securityId,
      sessionType: request.analysisType,
      requestPayload: request,
    }).returning();

    await tx.insert(agentSessionEvents).values({
      sessionId: created.id,
      eventType: 'plan_created',
      summary: input.origin === 'discovery_candidate'
        ? 'Approved Discovery candidate queued for Research Director analysis.'
        : 'Research queued: collect evidence, check statements, evaluate industry and review conclusions.',
      detail: input.origin === 'discovery_candidate'
        ? 'The approved market brief, thesis, portfolio scope, retained filings, market observations and price history will be loaded into one governed evidence foundation. No legacy analysis_run is created.'
        : 'Research only. No orders, weight changes or automatic report acceptance. Pause and cancellation retain completed records.',
      authority: 'autonomous',
      consequence: 'low',
      reversible: 1,
    });
    return created;
  });
}
