import type { DiscoveryCandidate } from '@portfolio-intelligence/agentic-contract';
import type { DiscoveryLatestPrice } from './discovery-market-data';

export type DiscoveryEvidenceScorecard = {
  assessment: 'developing' | 'limited';
  sourceUrlCount: number;
  groundingFieldCount: number;
  informationGapCount: number;
  conflictCount: number;
  marketPriceStatus: 'available' | 'unavailable';
  summary: string;
};

/** Counts describe the saved discovery snapshot, not truth, independence or sufficiency. */
export function scoreDiscoveryEvidence(
  candidate: Pick<DiscoveryCandidate, 'sourceUrls' | 'groundedIn' | 'informationGaps' | 'violatedCriteria'>,
  latestPrice: DiscoveryLatestPrice | null
): DiscoveryEvidenceScorecard {
  const sourceUrlCount = new Set(candidate.sourceUrls).size;
  const groundingFieldCount = new Set(candidate.groundedIn).size;
  const informationGapCount = candidate.informationGaps.length;
  const conflictCount = candidate.violatedCriteria.length;
  return {
    assessment: sourceUrlCount && groundingFieldCount ? 'developing' : 'limited',
    sourceUrlCount,
    groundingFieldCount,
    informationGapCount,
    conflictCount,
    marketPriceStatus: latestPrice ? 'available' : 'unavailable',
    summary: 'Source links and grounding fields are recorded references, not independently verified investment facts. Review unresolved criteria and conflicts before proceeding.',
  };
}
