import { describe, expect, it } from 'vitest';
import { confirmWeightsSchema, computeWeightsSchema, decisionWarnings, validateWeightVector, type WeightResult } from '../src/lib/portfolio-weights';

describe('audited allocation boundary', () => {
  it('requires explicit human confirmation and disallows direct weight writes', () => {
    const input = { portfolioId: '00000000-0000-4000-8000-000000000001', runId: '00000000-0000-4000-8000-000000000002', userChoice: 'recommendation', warningsAcknowledged: true };
    expect(confirmWeightsSchema.safeParse(input).success).toBe(false);
    expect(confirmWeightsSchema.safeParse({ ...input, confirm: true }).success).toBe(true);
    expect(confirmWeightsSchema.safeParse({ ...input, confirm: true, final_weights: { A: 1 } }).success).toBe(false);
    expect(confirmWeightsSchema.safeParse({ ...input, confirm: true, userChoice: null }).success).toBe(false);
  });
  it('requires real total-return attestation and finite settings', () => {
    const input = { portfolioId: '00000000-0000-4000-8000-000000000001', pricesCsv: 'date,A,B\n2026-09-01,1,2', source: 'Provider export', currency: 'BRL' };
    expect(computeWeightsSchema.safeParse(input).success).toBe(false);
    expect(computeWeightsSchema.safeParse({ ...input, totalReturnConfirmed: true }).success).toBe(true);
    expect(computeWeightsSchema.safeParse({ ...input, totalReturnConfirmed: true, config: { rf: NaN } }).success).toBe(false);
  });
  it('rejects non-finite, foreign, incomplete and cap-breaching allocations', () => {
    expect(() => validateWeightVector({ A: .5, B: .5 }, ['A', 'B'], .6)).not.toThrow();
    for (const vector of ([{ A: 1, B: 0 }, { A: .5, X: .5 }, { A: NaN, B: .5 }, { A: .4, B: .4 }] as Record<string, number>[]))
      expect(() => validateWeightVector(vector, ['A', 'B'], .6)).toThrow();
  });
  it('requires warnings for the chosen alternative and untested custom allocations', () => {
    const result = { recommendation: { recommended_method: '1/N', stability_flag: null, constraint_flag: null,
      ranking: { '1/N': { eligible: true, mad_from_base: 0 }, HRP: { eligible: false, mad_from_base: .1 } } } } as unknown as WeightResult;
    expect(decisionWarnings(result, 'recommendation')).toEqual([]);
    expect(decisionWarnings(result, 'HRP')).toHaveLength(2);
    expect(decisionWarnings(result, { A: 1 })).toHaveLength(1);
    expect(() => decisionWarnings(result, 'injected')).toThrow();
  });
});
