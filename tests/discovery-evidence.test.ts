import { describe, expect, it } from 'vitest';
import { scoreDiscoveryEvidence } from '../src/lib/discovery-evidence';

describe('discovery evidence inventory', () => {
  it('does not equate multiple links and identity fields with sufficient investment evidence', () => {
    const result = scoreDiscoveryEvidence({
      sourceUrls: ['https://example.com/a', 'https://example.com/b', 'https://example.com/a'],
      groundedIn: ['identity:ticker', 'identity:exchange', 'identity:ticker'],
      informationGaps: [], violatedCriteria: ['Excess leverage'],
    }, { close: 100, currency: 'CHF', asOf: '2026-09-08', provider: 'eodhd', sourceUrl: null });
    expect(result.assessment).toBe('developing');
    expect(result.sourceUrlCount).toBe(2);
    expect(result.groundingFieldCount).toBe(2);
    expect(result.conflictCount).toBe(1);
    expect(result.summary).toContain('not independently verified');
    expect(result.marketPriceStatus).toBe('available');
  });
  it('keeps missing evidence and market prices explicit', () => {
    const result = scoreDiscoveryEvidence({ sourceUrls: [], groundedIn: [], informationGaps: ['Revenue exposure unknown'], violatedCriteria: [] }, null);
    expect(result.assessment).toBe('limited');
    expect(result.informationGapCount).toBe(1);
    expect(result.marketPriceStatus).toBe('unavailable');
  });
});
