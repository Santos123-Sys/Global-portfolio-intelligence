import { describe, expect, it } from 'vitest';
import { emptyThesisPolicy, type ThesisCriteria } from '@portfolio-intelligence/agentic-contract';
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
  it('canonicalizes the Brazilian creator mandate instead of printing duplicate validator warnings', () => {
    const policy = emptyThesisPolicy();
    policy.rules = [
      { statement: 'Exclude all companies operating in the retail sector.', kind: 'hard', category: 'sector' },
      { statement: 'Exclude companies currently under judicial recovery proceedings.', kind: 'hard', category: 'risk' },
    ];
    const source: ThesisCriteria = {
      version: 1,
      portfolios: [{
        role: 'brazilian_growth', currency: 'BRL', objective: 'High-growth Brazilian equities', policy,
        inclusionCriteria: ['Listed equities on B3 (BVMF)', 'Early-stage growth companies with high growth potential'],
        exclusionCriteria: ['Retail sector companies', 'Companies in judicial recovery (recuperação judicial)', 'Exclude retail sector equities', 'Exclude companies undergoing judicial recovery (recuperação judicial)'],
      }],
      globalConstraints: [
        '100% equity scope per investor deviation from the 50/50 balanced questionnaire baseline',
        'Fixed income and other asset classes excluded from automated equity research',
        'Investor profile: balanced; questionnaire 42/75; suggested guide 50% stocks / 50% bonds.',
        'Strategy scope: investor-requested full-equity strategy.',
        'Liquidity context: withdrawals begin 3–5 years; withdrawal duration 6–10 years.',
        'Profiling framework is a general guide based on U.S. stock/bond assumptions, not comprehensive investment advice or a Brazilian suitability certification.',
        'Risk posture: Balanced profile operating under an investor-confirmed 100% equity scope targeting high-growth equities.',
        'Review cadence: Annual',
      ],
    };
    const review = assessThesisReview(source);
    const brazil = review.criteria.portfolios[0];
    expect(review.errors).toEqual([]);
    expect(review.warnings).toEqual([]);
    expect(review.needsAcknowledgment).toBe(false);
    expect(brazil.inclusionCriteria).toEqual([]);
    expect(brazil.exclusionCriteria).toEqual([]);
    expect(brazil.policy?.universe.listingMarkets).toContain('BVMF');
    expect(brazil.policy?.universe.sectorsExcluded).toContain('Retail');
    expect(brazil.policy?.rules).toContainEqual(expect.objectContaining({ statement: 'Early-stage growth companies with high growth potential', kind: 'preference' }));
    expect(brazil.policy?.rules).toContainEqual(expect.objectContaining({
      kind: 'hard', category: 'risk',
      predicate: expect.objectContaining({ mode: 'evidence', field: 'judicial_recovery_status', operator: 'eq', value: 'none', sourceRequirement: 'official' }),
    }));
    expect(review.contextIssues.some(issue => issue.cluster === 'mandate')).toBe(true);
  });
});
