import type { FilingLensReadState } from '../integrations/filinglens-client';
import type { Candidate, Decision, Profile } from './contracts';
/** ZIP-inspired staged gates. Comparisons only: GPI never derives a financial indicator. */
export function screenCandidate(candidate: Candidate, profile: Profile, finance: FilingLensReadState, now = new Date()) {
  const decisions: Decision[] = [{ stage: 'Market', status: profile.markets.includes(candidate.market) ? 'PASS' : 'FAIL',
    reason: `Allowed coverage: ${profile.markets.join(', ')}.`, evidenceIds: [] }];
  const growth = finance.status === 'ready' ? finance.snapshot.screening : null;
  const end = growth?.periodEnd ? new Date(growth.periodEnd).getTime() : NaN;
  const age = (now.getTime() - end) / 86_400_000;
  const validLineage = finance.status === 'ready' && finance.snapshot.screening.inputFactIds.length === 2 &&
    finance.snapshot.screening.inputFactIds.every(id => finance.snapshot.facts.some(f => f.id === id && f.metric === 'revenue' &&
      f.value !== null && ['single_source', 'verified'].includes(f.status)));
  if (profile.minimumRevenueGrowthPct === null) decisions.push({ stage: 'Revenue growth', status: 'NOT_REQUESTED', reason: 'No revenue threshold requested.', evidenceIds: [] });
  else if (!growth || growth.revenueGrowthYoYPct === null || !validLineage || !Number.isFinite(age) || age < 0 || age > profile.maxEvidenceAgeDays)
    decisions.push({ stage: 'Revenue growth', status: 'UNKNOWN', reason: finance.status !== 'ready' ? finance.reason : 'Missing, conflicting, stale or unsupported FilingLens growth evidence.', evidenceIds: [] });
  else decisions.push({ stage: 'Revenue growth', status: growth.revenueGrowthYoYPct >= profile.minimumRevenueGrowthPct ? 'PASS' : 'FAIL',
    reason: `FilingLens annual revenue growth ${growth.revenueGrowthYoYPct}% compared with requested ${profile.minimumRevenueGrowthPct}%.`, evidenceIds: growth.inputFactIds });
  decisions.push({ stage: 'Liquidity', status: profile.minimumAverageDailyShares === null ? 'NOT_REQUESTED' : 'UNKNOWN',
    reason: profile.minimumAverageDailyShares === null ? 'No liquidity threshold requested.' : 'Public filing snapshots do not supply validated daily trading volume. A market-data contract is required.', evidenceIds: [] });
  if (profile.objective !== 'growth') decisions.push({ stage: 'Objective evidence', status: 'UNKNOWN',
    reason: `${profile.objective} requires additional FilingLens dividend or financial-stability indicators.`, evidenceIds: [] });
  const requested = decisions.filter(d => d.stage !== 'Market' && d.status !== 'NOT_REQUESTED');
  const status = decisions.some(d => d.status === 'FAIL') ? 'FAIL' : !requested.length || decisions.some(d => d.status === 'UNKNOWN') ? 'UNKNOWN' : 'PASS';
  return { candidate, status, decisions, finance, screenedAt: now.toISOString(), policyVersion: 'usa-cvm-foundation-v1' };
}
export type ScreenResult = ReturnType<typeof screenCandidate>;
