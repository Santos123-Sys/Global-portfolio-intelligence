import { z } from 'zod';
import type { DiscoveryRunRequest, SecurityUniverseRecord } from './index.js';
import { evaluateThesisEligibility } from './thesis-domain.js';

export const EligibilityRuleResult = z.object({
  criterion: z.string(), thesisPath: z.string(),
  status: z.enum(['PASS', 'FAIL', 'UNKNOWN', 'NOT_APPLICABLE']),
  reason: z.string(), sourceUrl: z.string().url(), observedAt: z.string().datetime(),
}).strict();
export const DiscoveryScreening = z.object({
  portfolioId: z.string().uuid(), ticker: z.string(), exchange: z.string(), issuerKey: z.string(),
  status: z.enum(['eligible', 'ineligible', 'unverified', 'duplicate', 'already_known']),
  reasons: z.array(z.string()), rules: z.array(EligibilityRuleResult),
}).strict();
export const DiscoveryContext = z.object({
  thesisVersionId: z.string().uuid(), issuerKey: z.string(),
  channel: z.literal('structured_universe'), eligibility: DiscoveryScreening,
  evidence: z.array(z.object({
    url: z.string().url(), provider: z.string(),
    kind: z.enum(['structured_record', 'search_result']),
    tier: z.enum(['primary', 'data_provider', 'unclassified']),
    retrievedAt: z.string().datetime().nullable(), observedAt: z.string().datetime().optional(), publishedAt: z.string().nullable(),
    snippet: z.string().optional(),
  }).strict()),
}).strict();
export const ScreeningAudit = z.object({
  thesisVersionId: z.string().uuid(), records: z.array(DiscoveryScreening),
  researchAttempted: z.number().int().nonnegative(), researchFailed: z.number().int().nonnegative(),
  modelCalls: z.number().int().nonnegative(), elapsedMs: z.number().int().nonnegative(),
}).strict();

export function listingKey(record: Pick<SecurityUniverseRecord, 'exchange' | 'ticker'>) {
  return `${record.exchange.trim().toUpperCase()}:${record.ticker.trim().toUpperCase()}`;
}
/** Never infer common ownership from similar names or a shared ticker. */
export function issuerKey(record: SecurityUniverseRecord) {
  for (const field of ['issuer_lei', 'issuer_id', 'issuer_key']) {
    const value = record.attributes[field];
    if (typeof value === 'string' && value.trim()) return `${field}:${value.trim().toUpperCase()}`;
  }
  return `listing:${listingKey(record)}`;
}
export function discoveryMarkets(role: string) {
  return role === 'swiss_quality' ? ['XSWX'] : role === 'brazilian_growth' ? ['BVMF'] : [];
}

/** Pure, reproducible stage before any web/model requests. */
export function screenDiscoveryUniverse(request: DiscoveryRunRequest) {
  const records: z.infer<typeof DiscoveryScreening>[] = [];
  const eligibleByPortfolio = new Map<string, SecurityUniverseRecord[]>();
  for (const portfolio of request.portfolios) {
    const mandate = request.thesis.criteria.portfolios.find(p => p.role === portfolio.role);
    const selected: SecurityUniverseRecord[] = [];
    const seen = new Set<string>();
    const universe = request.universe.filter(r => discoveryMarkets(portfolio.role).includes(r.exchange))
      .slice().sort((a, b) => Number(b.attributes.listing_primary_status === 'Yes') - Number(a.attributes.listing_primary_status === 'Yes') || listingKey(a).localeCompare(listingKey(b)));
    for (const record of universe) {
      const review = mandate ? evaluateThesisEligibility(mandate, record) : null;
      const identity = issuerKey(record);
      const row: z.infer<typeof DiscoveryScreening> = {
        portfolioId: portfolio.id, ticker: record.ticker, exchange: record.exchange, issuerKey: identity,
        status: review?.status ?? 'unverified',
        reasons: review ? [...review.violated, ...review.unverified] : ['No matching approved mandate'],
        rules: review?.rules ?? [],
      };
      if (row.status === 'eligible') {
        const known = request.knownSecurities?.find(k => k.portfolioId === portfolio.id &&
          (k.reason !== 'rejected' || k.thesisVersionId === request.thesis.versionId) &&
          (listingKey(k) === listingKey(record) || k.issuerKey === identity));
        if (known) { row.status = 'already_known'; row.reasons.push(`Already ${known.reason.replaceAll('_', ' ')} in this portfolio`); }
        else if (seen.has(identity)) { row.status = 'duplicate'; row.reasons.push('Another eligible listing of this issuer was selected'); }
        else { seen.add(identity); selected.push(record); }
      }
      records.push(row);
    }
    eligibleByPortfolio.set(portfolio.id, selected);
  }
  return { records, eligibleByPortfolio };
}
