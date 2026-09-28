import { describe, expect, it } from 'vitest';
import { portfolioExposure } from '../src/lib/portfolio-exposure';

const holding = (id: string, currency: string, value: string | null, weight: number | null) =>
  ({ id, currency, marketValueNative: value, weight });

describe('portfolio exposure integrity', () => {
  it('uses complete stored weights when holdings have different denominations', () => {
    const result = portfolioExposure([holding('ch', 'CHF', '100', .4), holding('br', 'BRL', '1000', .6)], 'CHF');
    expect(result.source).toBe('stored weights');
    expect(result.rows.map((row) => row.effectiveWeight)).toEqual([.4, .6]);
  });

  it('refuses to blend raw CHF and BRL values when weights are incomplete', () => {
    const result = portfolioExposure([holding('ch', 'CHF', '100', .4), holding('br', 'BRL', '1000', null)], 'CHF');
    expect(result.source).toBeNull();
    expect(result.rows).toHaveLength(0);
  });

  it('falls back to comparable native values only when every holding is valued', () => {
    const result = portfolioExposure([holding('a', 'CHF', '75', null), holding('b', 'CHF', '25', null)], 'CHF');
    expect(result.source).toBe('native values');
    expect(result.rows.map((row) => row.effectiveWeight)).toEqual([.75, .25]);
    expect(portfolioExposure([holding('a', 'CHF', '75', null), holding('b', 'CHF', null, null)], 'CHF').source).toBeNull();
  });

  it('rejects partial and out-of-range weight sets', () => {
    expect(portfolioExposure([holding('a', 'CHF', null, .5), holding('b', 'CHF', null, .2)], 'CHF').source).toBeNull();
    expect(portfolioExposure([holding('a', 'CHF', null, 1.2), holding('b', 'CHF', null, -.2)], 'CHF').source).toBeNull();
  });
});
