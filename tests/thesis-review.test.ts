import { describe, expect, it } from 'vitest';
import type { ThesisCriteria } from '@portfolio-intelligence/agentic-contract';
import { assessThesisReview } from '../src/lib/thesis-review';

const thesis = (): ThesisCriteria => ({ version: 1, portfolios: [{ role: 'swiss_quality', currency: ' chf ', objective: ' Durable compounding ', inclusionCriteria: [' Recurring revenue ', ''], exclusionCriteria: ['Highly leveraged'], targetMetrics: { horizon: '5 years' } }], globalConstraints: [' No leverage ', ''] });

describe('canonical thesis review', () => {
  it('normalizes edits without changing the source object', () => {
    const source = thesis(); const reviewed = assessThesisReview(source);
    expect(reviewed.errors).toEqual([]);
    expect(reviewed.criteria.portfolios[0]).toMatchObject({ currency: 'CHF', objective: 'Durable compounding', inclusionCriteria: ['Recurring revenue'] });
    expect(source.portfolios[0].currency).toBe(' chf ');
  });
  it('blocks duplicate destinations and exact conflicting criteria', () => {
    const source = thesis(); source.portfolios.push(structuredClone(source.portfolios[0]));
    source.portfolios[0].exclusionCriteria.push('recurring   REVENUE');
    expect(assessThesisReview(source).errors.join(' ')).toMatch(/Duplicate portfolio/);
    expect(assessThesisReview(source).errors.join(' ')).toMatch(/both inclusion and exclusion/);
  });
  it('blocks empty objectives, incomplete metrics and configured currency conflicts', () => {
    const source = thesis(); Object.assign(source.portfolios[0], { currency: 'USD', objective: ' ', targetMetrics: { horizon: '' } });
    expect(assessThesisReview(source).errors).toHaveLength(3);
  });
  it('keeps unsupported but valid mandates and labels the discovery limitation', () => {
    const source = thesis(); source.portfolios[0].role = 'global_growth'; source.portfolios[0].currency = 'USD';
    const review = assessThesisReview(source);
    expect(review.errors).toEqual([]);
    expect(review.warnings.join(' ')).toContain('not configured');
  });
});
