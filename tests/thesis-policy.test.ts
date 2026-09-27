import { describe, it, expect } from 'vitest';
import {
  emptyThesisPolicy,
  evaluateThesisEligibility,
  thesisDiscoveryPlan,
  reviewStructuredThesis,
  diffThesis,
  ThesisCriteria,
  type SecurityUniverseRecord,
} from '@portfolio-intelligence/agentic-contract';
import { assessThesisReview } from '../src/lib/thesis-review';
import { ThesisDraft } from '../src/lib/thesis-draft';
const thesis = (
  role = 'brazilian_growth',
  currency = 'BRL',
): ThesisCriteria => ({
  version: 1,
  portfolios: [
    {
      role,
      currency,
      objective: 'Long-term capital growth',
      inclusionCriteria: [],
      exclusionCriteria: [],
      policy: {
        ...emptyThesisPolicy(),
        universe: {
          ...emptyThesisPolicy().universe,
          listingMarkets: [role === 'swiss_quality' ? 'XSWX' : 'BVMF'],
        },
      },
    },
  ],
  globalConstraints: [],
});
const security = (
  patch: Partial<SecurityUniverseRecord> = {},
): SecurityUniverseRecord => ({
  ticker: 'TEST3',
  exchange: 'BVMF',
  companyName: 'Example',
  currency: 'BRL',
  country: 'Brazil',
  sector: 'Industrials',
  industry: 'Machinery',
  assetType: 'Common Stock',
  observedAt: '2026-09-27T00:00:00Z',
  provider: 'fixture',
  sourceUrl: 'https://example.com',
  attributes: { issuer_domicile_country_iso2: 'BR' },
  ...patch,
});
describe('structured thesis policy', () => {
  it('normal and minimal cases preserve explicit mandate without adding thresholds', () => {
    const t = thesis();
    expect(ThesisCriteria.parse(t)).toEqual(t);
    expect(assessThesisReview(t).errors).toEqual([]);
    expect(evaluateThesisEligibility(t.portfolios[0], security()).status).toBe(
      'eligible',
    );
    expect(t.portfolios[0].policy!.rules).toEqual([]);
  });
  it('qualitative thesis exposes original statement, interpretation and proxy without fabricating a predicate', () => {
    const t = thesis();
    t.portfolios[0].policy!.rules = [
      { statement: 'High quality', kind: 'preference', category: 'selection' },
    ];
    const issues = reviewStructuredThesis(t);
    expect(
      issues.some(
        (i) =>
          i.statement === 'High quality' &&
          !!i.proxy &&
          i.interpretation.includes('no invented threshold'),
      ),
    ).toBe(true);
    expect(evaluateThesisEligibility(t.portfolios[0], security()).status).toBe(
      'eligible',
    );
  });
  it('blocks actual contradictions but only warns on growth/value tension', () => {
    const t = thesis(),
      p = t.portfolios[0].policy!;
    p.targetHoldings = 20;
    p.maximumHoldings = 6;
    p.universe.sectorsIncluded = ['Banks'];
    p.universe.sectorsExcluded = ['banks'];
    p.rules = [
      {
        statement: 'Minimum ROIC',
        kind: 'hard',
        category: 'selection',
        metric: {
          field: 'roic',
          operator: 'gte',
          value: 20,
          unit: 'percent',
          period: 'FY2025',
        },
      },
      {
        statement: 'Maximum ROIC',
        kind: 'hard',
        category: 'selection',
        metric: {
          field: 'roic',
          operator: 'lte',
          value: 10,
          unit: 'percent',
          period: 'FY2025',
        },
      },
    ];
    expect(
      reviewStructuredThesis(t).filter((i) => i.severity === 'blocking'),
    ).toHaveLength(3);
    const soft = thesis();
    soft.portfolios[0].objective = 'High-growth with low valuation';
    expect(
      reviewStructuredThesis(soft).some((i) => i.severity === 'blocking'),
    ).toBe(false);
  });
  it('separates domicile, listing, operations and revenue; reporting currency is not geography', () => {
    const t = thesis();
    Object.assign(t.portfolios[0].policy!.universe, {
      domicileCountries: ['CH'],
      operatingCountries: ['US'],
      revenueCountries: ['BR'],
    });
    const r = security({
      currency: 'USD',
      attributes: {
        issuer_domicile_country_iso2: 'CH',
        operating_country_iso2: 'US',
        revenue_country_iso2: 'BR',
      },
    });
    expect(evaluateThesisEligibility(t.portfolios[0], r).status).toBe(
      'eligible',
    );
    expect(
      evaluateThesisEligibility(t.portfolios[0], { ...r, attributes: {} })
        .status,
    ).toBe('unverified');
    expect(evaluateThesisEligibility(t.portfolios[0], security()).status).toBe(
      'ineligible',
    );
  });
  it('generates different Brazilian and Swiss searches', () => {
    expect(thesisDiscoveryPlan(thesis())[0]).toMatchObject({
      reportingCurrency: 'BRL',
      searchMarkets: ['BVMF'],
    });
    expect(
      thesisDiscoveryPlan(thesis('swiss_quality', 'CHF'))[0],
    ).toMatchObject({ reportingCurrency: 'CHF', searchMarkets: ['XSWX'] });
  });
  it('hard predicates require matching evidence, units and periods; soft and context never reject', () => {
    const t = thesis(),
      p = t.portfolios[0],
      rule = {
        statement: 'ROIC at least 15 percent FY2025',
        kind: 'hard' as const,
        category: 'selection' as const,
        metric: {
          field: 'roic',
          operator: 'gte' as const,
          value: 15,
          unit: 'percent',
          period: 'FY2025',
        },
      };
    p.policy!.rules = [rule];
    expect(evaluateThesisEligibility(p, security()).status).toBe('unverified');
    expect(
      evaluateThesisEligibility(
        p,
        security({
          attributes: { roic: 20, roic_unit: 'percent', roic_period: 'FY2024' },
        }),
      ).status,
    ).toBe('unverified');
    expect(
      evaluateThesisEligibility(
        p,
        security({
          attributes: { roic: 10, roic_unit: 'percent', roic_period: 'FY2025' },
        }),
      ).status,
    ).toBe('ineligible');
    expect(
      evaluateThesisEligibility(
        p,
        security({
          attributes: { roic: 20, roic_unit: 'percent', roic_period: 'FY2025' },
        }),
      ).status,
    ).toBe('eligible');
    p.policy!.rules = [
      { ...rule, kind: 'preference' },
      { statement: 'Falling rates', kind: 'context', category: 'macro' },
    ];
    expect(evaluateThesisEligibility(p, security()).status).toBe('eligible');
  });
  it('retains historical schemas and identifies modifications without mutating originals', () => {
    const old = thesis();
    delete old.portfolios[0].policy;
    expect(ThesisCriteria.safeParse(old).success).toBe(true);
    const now = structuredClone(old);
    now.version = 2;
    now.portfolios[0].objective = 'Income';
    expect(diffThesis(old, now)).toEqual([
      {
        path: 'portfolios[0].objective',
        previous: 'Long-term capital growth',
        current: 'Income',
        kind: 'modified',
      },
    ]);
    expect(old.version).toBe(1);
  });
  it('recovers incomplete drafts but rejects them at approval', () => {
    const t = thesis();
    t.portfolios[0].objective = '';
    t.portfolios[0].policy!.rules = [
      { statement: '', kind: 'preference', category: 'risk' },
    ];
    const draft = {
      schemaVersion: 1,
      criteria: t,
      selectedId: null,
      manual: true,
      baseVersionId: null,
      reviewNotes: '',
    };
    expect(
      ThesisDraft.safeParse(JSON.parse(JSON.stringify(draft))).success,
    ).toBe(true);
    expect(ThesisCriteria.safeParse(t).success).toBe(false);
  });
  it('never equates vague exclusions with measurable eligibility', () => {
    const t = thesis();
    t.portfolios[0].policy!.rules = [
      { statement: 'Good management', kind: 'hard', category: 'selection' },
    ];
    expect(evaluateThesisEligibility(t.portfolios[0], security()).status).toBe(
      'unverified',
    );
    expect(assessThesisReview(t).needsAcknowledgment).toBe(true);
  });
});
