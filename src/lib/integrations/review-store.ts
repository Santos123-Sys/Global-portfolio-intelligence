import { createHash, randomUUID } from 'node:crypto';
import { JobRequest } from '../foundation/contracts';
import { sql } from '../foundation/store';
import { IntegrationEventV1, ResearchDecisionV1, ReviewRequestV1, resolveIssuer } from './shared-contracts';
import type { ResearchDecisionV1 as ResearchDecision } from './shared-contracts';

export class HandoffError extends Error {
  constructor(readonly code: 'research_not_ready' | 'identity_not_confirmed' | 'idempotency_conflict') { super(code); }
}

export async function listReviews(ownerId: string) {
  const rows = await sql()`SELECT review, created_at FROM gpi_integration_reviews WHERE owner_id=${ownerId} ORDER BY created_at DESC LIMIT 50`;
  return rows.map(row => ResearchDecisionV1.parse(row.review));
}

/** Only a completed, account-owned research job can be reviewed; no model can self-approve. */
export async function reviewResearch(ownerId: string, workspaceId: string, reviewerUserId: string, input: unknown) {
  const request = ReviewRequestV1.parse(input);
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  return sql().begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId + ':integration-reviews'},0))`;
    const existing = await tx`SELECT request_hash,review FROM gpi_integration_reviews
      WHERE owner_id=${ownerId} AND idempotency_key=${request.idempotencyKey}`;
    if (existing[0]) {
      if (existing[0].request_hash !== requestHash) throw new HandoffError('idempotency_conflict');
      return { review: ResearchDecisionV1.parse(existing[0].review), reused: true, delivered: false };
    }
    const jobs = await tx`SELECT input,output,status FROM gpi_foundation_jobs
      WHERE id=${request.sourceResearchJobId} AND owner_id=${ownerId} LIMIT 1`;
    const job = jobs[0];
    if (!job || job.status !== 'complete') throw new HandoffError('research_not_ready');
    const inputJob = JobRequest.safeParse(job.input);
    if (!inputJob.success || inputJob.data.kind !== 'research') throw new HandoffError('research_not_ready');
    const candidate = inputJob.data.workspace.candidates.find(c => c.key === inputJob.data.candidateKey);
    const output = job.output as Record<string, unknown> | null;
    const report = output?.report as Record<string, unknown> | undefined;
    const reportCandidate = report?.candidate as Record<string, unknown> | undefined;
    if (!candidate || output?.kind !== 'research' || report?.approval !== 'human_review_required' ||
      report?.financialAuthority !== 'FilingLens' || reportCandidate?.key !== candidate.key)
      throw new HandoffError('research_not_ready');
    const identity = resolveIssuer(candidate);
    if (request.decision === 'request_analysis' &&
      (identity.status !== 'source_linked' || !request.confirmIssuerMapping))
      throw new HandoffError('identity_not_confirmed');
    const reviewId = randomUUID();
    const eventId = randomUUID();
    const reviewedAt = new Date().toISOString();
    const issuer = identity.status === 'source_linked' ?
      { ...identity.issuer, verification: request.confirmIssuerMapping ? 'analyst_confirmed' as const : 'source_linked' as const } : null;
    const finance = (report?.screen as Record<string, unknown> | undefined)?.finance as Record<string, unknown> | undefined;
    const evidenceStatus = identity.status === 'unmapped' ? 'unmapped' :
      finance?.status === 'ready' ? 'source_linked' : 'unavailable';
    const review: ResearchDecision = ResearchDecisionV1.parse({
      schemaVersion: 'research-decision.v1', reviewId, workspaceId, reviewerUserId,
      sourceResearchJobId: request.sourceResearchJobId, issuer, candidateKey: candidate.key,
      decision: request.decision, rationale: request.rationale, reviewedAt, evidenceStatus,
      exportStatus: 'awaiting_provider',
    });
    const payloadHash = createHash('sha256').update(JSON.stringify({ reviewId, decision: request.decision,
      candidateKey: candidate.key, issuerId: issuer?.issuerId ?? null })).digest('hex');
    const event = IntegrationEventV1.parse({ schemaVersion: 'integration-event.v1', eventId,
      eventType: 'candidate.reviewed.v1', workspaceId, source: 'gpi', occurredAt: reviewedAt,
      objectId: reviewId, objectVersion: 1, correlationId: request.sourceResearchJobId, payloadHash });
    await tx`INSERT INTO gpi_integration_reviews
      (id,owner_id,workspace_id,reviewer_user_id,source_job_id,idempotency_key,request_hash,decision,review)
      VALUES (${reviewId},${ownerId},${workspaceId},${reviewerUserId},${request.sourceResearchJobId},
        ${request.idempotencyKey},${requestHash},${request.decision},${tx.json(review)})`;
    await tx`INSERT INTO gpi_integration_outbox (event_id,owner_id,workspace_id,review_id,event)
      VALUES (${eventId},${ownerId},${workspaceId},${reviewId},${tx.json(event)})`;
    return { review, reused: false, delivered: false };
  });
}
