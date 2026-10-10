import { z } from 'zod';
import { Candidate } from '../foundation/contracts';

export const Coverage = z.enum(['us', 'br']);
const Id = z.string().uuid();
const Instant = z.string().datetime({ offset: true });
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Currency = z.enum(['USD', 'BRL']);
const Exchange = z.enum(['XNAS', 'XNYS', 'XASE', 'ARCX', 'BVMF']);

/** An identity asserted by a GPI source, not a regulator-certified mapping. */
export const IssuerIdentityV1 = z.object({
  schemaVersion: z.literal('issuer.v1'),
  issuerId: z.string().regex(/^(us:\d{10}|br:\d{14})$/),
  jurisdiction: Coverage,
  registryId: z.string().regex(/^\d{10}$|^\d{14}$/),
  listingKey: z.string().regex(/^[A-Z0-9.:-]{1,60}$/),
  ticker: z.string().regex(/^[A-Z0-9.-]{1,20}$/),
  exchange: Exchange,
  identitySourceUrl: z.string().url(),
  verification: z.enum(['source_linked', 'analyst_confirmed']),
}).strict().superRefine((value, ctx) => {
  if (value.issuerId !== value.jurisdiction + ':' + value.registryId ||
    value.registryId.length !== (value.jurisdiction === 'us' ? 10 : 14) ||
    value.listingKey !== value.exchange + ':' + value.ticker ||
    (value.exchange === 'BVMF' ? 'br' : 'us') !== value.jurisdiction ||
    /^0+$/.test(value.registryId))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent SEC/CVM issuer identity' });
  try {
    const url = new URL(value.identitySourceUrl);
    const host = url.hostname.toLowerCase();
    const official = value.jurisdiction === 'us'
      ? host === 'sec.gov' || host.endsWith('.sec.gov')
      : ['dados.cvm.gov.br', 'sistemas.cvm.gov.br', 'www.gov.br'].includes(host);
    if (url.protocol !== 'https:' || url.username || url.password || !official)
      throw new Error('non-official');
  } catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Official regulator identity source required' }); }
});
export type IssuerIdentityV1 = z.infer<typeof IssuerIdentityV1>;
export type IssuerResolution = { status: 'source_linked'; issuer: IssuerIdentityV1 } |
  { status: 'unmapped'; reason: 'missing_registry_id' | 'invalid_regulator_source' };

/** Never infer a CNPJ/CIK from a ticker. Analyst confirmation is a separate action. */
export function resolveIssuer(candidate: Candidate): IssuerResolution {
  if (!candidate.issuer) return { status: 'unmapped', reason: 'missing_registry_id' };
  const proposed = {
    schemaVersion: 'issuer.v1' as const,
    issuerId: candidate.issuer.jurisdiction + ':' + candidate.issuer.registryId,
    jurisdiction: candidate.issuer.jurisdiction,
    registryId: candidate.issuer.registryId,
    listingKey: candidate.key,
    ticker: candidate.ticker,
    exchange: candidate.exchange,
    identitySourceUrl: candidate.identitySourceUrl,
    verification: 'source_linked' as const,
  };
  const parsed = IssuerIdentityV1.safeParse(proposed);
  return parsed.success ? { status: 'source_linked', issuer: parsed.data } :
    { status: 'unmapped', reason: 'invalid_regulator_source' };
}

/** The source of valuation numbers is always FilingLens. GPI never computes or approves them. */
export const ValuationVersionV1 = z.object({
  schemaVersion: z.literal('valuation.v1'),
  valuationVersionId: z.string().min(1).max(120),
  issuerId: z.string().regex(/^(us:\d{10}|br:\d{14})$/),
  method: z.enum(['dcf', 'comps']),
  scenario: z.string().min(1).max(100),
  currency: Currency,
  impliedValuePerShare: z.string().regex(/^\d+(\.\d+)?$/),
  valuationAsOf: Instant,
  approvedAt: Instant,
  approvedBy: z.string().min(1).max(160),
  sourceSnapshotIds: z.array(z.string().min(1).max(160)).min(1).max(20),
  assumptionsHash: Digest,
  approvalStatus: z.literal('approved'),
}).strict();

export const PortfolioExposureV1 = z.object({
  schemaVersion: z.literal('portfolio-exposure.v1'),
  portfolioId: Id,
  workspaceId: Id,
  snapshotId: z.string().min(1).max(160),
  baseCurrency: Currency,
  asOf: Instant,
  source: z.literal('portfolio-risk-studio'),
  status: z.enum(['ready', 'stale', 'partial', 'unknown']),
  holdingsCount: z.number().int().min(0).max(10000),
  sectorWeights: z.record(z.string().regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/)),
  countryWeights: z.record(z.string().regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/)),
  methodologyVersion: z.string().min(1).max(100),
}).strict();

export const RiskRunV1 = z.object({
  schemaVersion: z.literal('portfolio-risk.v1'),
  runId: Id,
  portfolioId: Id,
  workspaceId: Id,
  asOf: Instant,
  snapshotId: z.string().min(1).max(160),
  status: z.enum(['ready', 'partial', 'unknown', 'failed']),
  priceSource: z.string().min(1).max(100),
  fxSource: z.string().nullable(),
  baseCurrency: Currency,
  methodVersion: z.string().min(1).max(100),
  warnings: z.array(z.string().max(250)).max(30),
  resultReference: z.string().min(1).max(160).nullable(),
}).strict();

export const ReviewRequestV1 = z.object({
  sourceResearchJobId: Id,
  decision: z.enum(['request_analysis', 'watchlist', 'reject']),
  rationale: z.string().trim().min(20).max(2000),
  idempotencyKey: Id,
  confirmIssuerMapping: z.boolean().default(false),
}).strict();
export type ReviewRequestV1 = z.infer<typeof ReviewRequestV1>;

export const ResearchDecisionV1 = z.object({
  schemaVersion: z.literal('research-decision.v1'),
  reviewId: Id,
  workspaceId: Id,
  reviewerUserId: Id,
  sourceResearchJobId: Id,
  issuer: IssuerIdentityV1.nullable(),
  candidateKey: z.string().max(60),
  decision: ReviewRequestV1.shape.decision,
  rationale: ReviewRequestV1.shape.rationale,
  reviewedAt: Instant,
  evidenceStatus: z.enum(['source_linked', 'unmapped', 'unavailable']),
  exportStatus: z.literal('awaiting_provider'),
}).strict();
export type ResearchDecisionV1 = z.infer<typeof ResearchDecisionV1>;

export const IntegrationEventV1 = z.object({
  schemaVersion: z.literal('integration-event.v1'),
  eventId: Id,
  eventType: z.enum(['candidate.reviewed.v1', 'valuation.approved.v1', 'portfolio.positions.updated.v1', 'portfolio.risk.threshold_breached.v1']),
  workspaceId: Id,
  source: z.enum(['gpi', 'filinglens', 'portfolio-risk-studio']),
  occurredAt: Instant,
  objectId: z.string().min(1).max(160),
  objectVersion: z.number().int().positive(),
  correlationId: Id,
  payloadHash: Digest,
}).strict();
export type IntegrationEventV1 = z.infer<typeof IntegrationEventV1>;
