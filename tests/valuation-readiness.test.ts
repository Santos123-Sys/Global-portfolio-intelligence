import { marketProfiles } from '@portfolio-intelligence/agentic-contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ sector: 'Industrials', facts: [] as Array<Record<string, unknown>>, saved: null as Record<string, unknown> | null, selects: 0 }));
vi.mock('../src/lib/api-auth', () => ({ authenticateRequest: async () => ({ ok: true, auth: { userId: 'owner', email: 'owner@example.test' } }) }));
vi.mock('../src/lib/auth', () => ({ assertSameOrigin: () => undefined }));
vi.mock('../src/lib/db', () => ({ db: {
  select: () => {
    state.selects++;
    return { from: () => ({ where: () => ({
      limit: async () => [{ id: '11111111-1111-4111-8111-111111111111', securityId: 'security', analysisId: 'analysis', exchange: 'XSWX', ticker: 'TEST', runId: 'run', currency: 'CHF', sector: state.sector }],
      orderBy: async () => state.facts,
    }) }) };
  },
  insert: () => ({ values: (value: Record<string, unknown>) => { state.saved = value; return { returning: async () => [{ id: 'scenario', ...value }] }; } }),
} }));
import { POST } from '../src/app/api/discovery/valuations/route';

const fiscalDate = '2025-12-31';
beforeEach(() => {
  state.sector = 'Industrials'; state.selects = 0; state.saved = null;
  const values: Record<string, number> = { free_cash_flow_to_firm: 100, total_debt: 50, cash_and_equivalents: 20, shares_outstanding: 10 };
  for (const name of ['worst_case', 'base_case', 'optimistic_case']) {
    values[`dcf_${name}_fcf_growth_rate`] = 0.04;
    values[`dcf_${name}_discount_rate`] = 0.10;
    values[`dcf_${name}_terminal_growth_rate`] = 0.02;
  }
  state.facts = Object.entries(values).map(([metricName, value]) => ({ id: metricName, metricName, valueNumeric: String(value), currency: 'CHF', observationDate: fiscalDate, retrievedAt: new Date('2026-09-26'), provider: 'investor-relations', sourceName: 'Annual filing', sourceUrl: 'https://issuer.test/annual' }));
});
const submit = () => POST(new Request('http://localhost/api/discovery/valuations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId: '11111111-1111-4111-8111-111111111111', automatic: true }) }));

describe('valuation API method and evidence gates', () => {
  it('does not accept generic FCF in place of explicitly identified FCFF', async () => {
    state.facts[0].metricName = 'free_cash_flow';
    const response = await submit();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('not automatically FCFF');
    expect(state.saved).toBeNull();
  });
  it('enforces method suitability even when every numerical input exists', async () => {
    state.sector = 'Financial Services';
    const response = await submit();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('poor fit');
    expect(state.saved).toBeNull();
  });
  it('rejects conflicting facts instead of selecting an arbitrary value', async () => {
    state.facts.push({ ...state.facts[0], valueNumeric: '200' });
    expect((await submit()).status).toBe(409);
    expect(state.saved).toBeNull();
  });
  it('requires explicit market review even when older scenario rates exist', async () => {
    const response = await submit();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('six market dimensions');
  });
});

const datum = (value: number) => ({ value, asOf: new Date().toISOString().slice(0, 10), sourceRef: 'https://issuer.test/assumptions' });
const review = {
  market: {
    profileSnapshot: marketProfiles,
    context: { incorporationCountry: 'CH', listingExchanges: ['XSWX'], reportingCurrency: 'CHF', accountingStandard: 'IFRS', revenueGeography: [{ country: 'CH', share: 1 }], regulatoryJurisdictions: ['CH'], sector: 'Industrials', commodityRevenueShare: null, exportRevenueShare: null,
      sourceReferences: Object.fromEntries(['incorporationCountry', 'listingExchanges', 'reportingCurrency', 'accountingStandard', 'revenueGeography', 'regulatoryJurisdictions'].map(k => [k, 'https://issuer.test/annual'])) },
    capital: { currency: 'CHF', cashFlowBasis: 'nominal', riskFreeBasis: 'nominal', riskFreeRate: datum(.04), expectedInflation: null, matureErp: datum(.05), countryRiskPremium: datum(0), beta: datum(1.2), taxRate: datum(.2), preTaxCostOfDebt: datum(.05), equityWeight: datum(1), debtIncludesCountryRisk: true, additionalDebtSpread: null },
  },
  confirmed: true, financialPeriodEnd: fiscalDate, currency: 'CHF', asOf: '2026-09-25', sourceUrl: 'https://issuer.test/assumptions',
  rationale: 'Reviewed annual financials and currency-consistent cost of capital.',
  fcff: { method: 'ebit', workingCapitalInvestment: 20, interestIncludedInCfo: false },
  scenarios: Object.fromEntries(['worst_case', 'base_case', 'optimistic_case'].map(name => [name, { annualGrowthRate: .04, discountRate: .1, terminalGrowthRate: .02 }])),
};
function derivedFacts() {
  const template = state.facts[0];
  state.facts = state.facts.filter(row => !String(row.metricName).startsWith('dcf_') && row.metricName !== 'free_cash_flow_to_firm');
  state.facts.push(...Object.entries({ operating_income: 200, depreciation_and_amortization: 20, capital_expenditure: 50, income_tax_expense: 40, pre_tax_income: 200 }).map(([metricName, value]) => ({ ...template, id: metricName, metricName, valueNumeric: String(value) })));
}
const submitReview = (value: unknown) => POST(new Request('http://localhost/api/discovery/valuations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId: '11111111-1111-4111-8111-111111111111', automatic: true, review: value }) }));
it('derives FCFF and saves reviewed assumptions with original evidence', async () => {
  derivedFacts();
  const response = await submitReview(review);
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.result.scenarios[1].result.assumptions.dataAsOf).toBe(fiscalDate);
  expect(body.result.market.capital.wacc).toBeCloseTo(.1);
  expect(body.result.fcffDerivation.value).toBe(110);
  expect(body.result.scenarios[1].result.assumptions.startingFreeCashFlow).toBe(110);
  expect(state.saved?.status).toBe('human_confirmed');
  expect(state.saved?.assumptionsJson).toMatchObject({ review, financialInputs: { operating_income: 200 } });
  expect(state.saved?.sourceReferences).toContain('https://issuer.test/assumptions');
});
it('rejects stale financial periods and currency mismatches', async () => {
  derivedFacts();
  expect((await submitReview({ ...review, financialPeriodEnd: '2024-12-31' })).status).toBe(409);
  expect((await submitReview({ ...review, currency: 'USD' })).status).toBe(409);
  expect(state.saved).toBeNull();
});
it('does not let a reviewed form override missing sourced financial facts', async () => {
  derivedFacts(); state.facts = state.facts.filter(row => row.metricName !== 'operating_income');
  expect((await submitReview(review)).status).toBe(409);
  expect(state.saved).toBeNull();
});
it('rejects unconfirmed and invalid rate reviews', async () => {
  expect((await submitReview({ ...review, confirmed: false })).status).toBe(400);
  expect((await submitReview({ ...review, scenarios: { ...review.scenarios, base_case: { annualGrowthRate: .04, discountRate: .02, terminalGrowthRate: .02 } } })).status).toBe(400);
});

it('binds reviewed market context to the saved security and rejects invalid computed capital', async () => {
  derivedFacts();
  for (const context of [{ ...review.market.context, listingExchanges: ['NYSE'] }, { ...review.market.context, sector: 'Technology' }]) {
    expect((await submitReview({ ...review, market: { ...review.market, context } })).status).toBe(409);
  }
  const response = await submitReview({ ...review, market: { ...review.market, capital: { ...review.market.capital, beta: datum(10), matureErp: datum(.5) } } });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain('Computed WACC');
  expect(state.saved).toBeNull();
});

it('rejects a stale policy snapshot before saving a valuation', async () => {
  derivedFacts();
  const response = await submitReview({ ...review, market: { ...review.market, profileSnapshot: marketProfiles.map(p => ({ ...p, version: 'old' })) } });
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain('Market policies changed');
  expect(state.saved).toBeNull();
});
