import { describe, expect, it } from 'vitest';
import { buildMarketPlan, marketContextFromRecord, validateMarketValuation, computeCostOfCapital, countryRiskFromSpread, releverBeta, valueCashFlows, screenMarketPeers, reconcileValuations, type MarketContext, type CapitalInputs } from '@portfolio-intelligence/agentic-contract';
const now = new Date('2026-09-28T00:00:00Z');
const datum = (value: number) => ({ value, asOf: '2026-09-27', sourceRef: 'https://issuer.example/assumptions' });
function context(country = 'US', exchange = 'NYSE', currency = 'USD'): MarketContext {
  return { incorporationCountry: country, listingExchanges: [exchange], reportingCurrency: currency, accountingStandard: country === 'US' ? 'US_GAAP' : 'IFRS', revenueGeography: [{ country, share: 1 }], regulatoryJurisdictions: [country], sector: 'Industrials', commodityRevenueShare: null, exportRevenueShare: null,
    sourceReferences: Object.fromEntries(['incorporationCountry', 'listingExchanges', 'reportingCurrency', 'accountingStandard', 'revenueGeography', 'regulatoryJurisdictions'].map(k => [k, 'https://issuer.example/annual'])) };
}
const capital: CapitalInputs = { currency: 'BRL', cashFlowBasis: 'nominal', riskFreeBasis: 'real', riskFreeRate: datum(.04), expectedInflation: datum(.05), matureErp: datum(.05), countryRiskPremium: datum(.03), beta: datum(1.2), taxRate: datum(.34), preTaxCostOfDebt: datum(.1), equityWeight: datum(.8), debtIncludesCountryRisk: true, additionalDebtSpread: null };
describe('market routing and noninterchangeable dimensions', () => {
  it('creates different US, Brazilian commodity and hybrid plans', () => {
    const us = buildMarketPlan(context());
    const br = buildMarketPlan({ ...context('BR', 'BVMF', 'BRL'), sector: 'Materials', exportRevenueShare: .7 });
    const hybrid = buildMarketPlan({ ...context('BR', 'NYSE', 'USD'), regulatoryJurisdictions: ['BR', 'US'], revenueGeography: [{ country: 'US', share: .6 }, { country: 'BR', share: .4 }] });
    expect(us.nodes.some(n => n.id === 'CountryRiskAgent')).toBe(false);
    expect(br.nodes.some(n => n.id === 'CountryRiskAgent')).toBe(true);
    expect(br.nodes.some(n => n.id === 'CommodityFXAgent')).toBe(true);
    expect(hybrid.hybrid).toBe(true); expect(hybrid.profiles.map(p => p.country)).toEqual(['US', 'BR']);
    expect(hybrid.context.accountingStandard).toBe('IFRS'); expect(hybrid.context.reportingCurrency).toBe('USD');
    for (const plan of [us, br, hybrid]) for (const [ix, node] of plan.nodes.entries())
      expect(node.dependencies.every(d => plan.nodes.slice(0, ix).some(n => n.id === d))).toBe(true);
  });
  it('preserves Swiss analysis and never routes a company solely because it uses IFRS', () => {
    expect(buildMarketPlan(context('CH', 'XSWX', 'CHF')).profiles.map(p => p.country)).toEqual(['CH']);
    expect(buildMarketPlan(context('FR', 'XPAR', 'EUR')).profiles).toEqual([]);
    const unknown = marketContextFromRecord({ exchange: 'BVMF', sector: null });
    expect(marketContextFromRecord({ exchange: 'NYSE', sector: null, attributes: { domicile_country: 'US' } }).incorporationCountry).toBeNull();
    expect(unknown.incorporationCountry).toBeNull(); expect(unknown.reportingCurrency).toBeNull();
    expect(buildMarketPlan(unknown).issues.some(i => i.code === 'missing_revenueGeography')).toBe(true);
  });
  it('blocks incomplete exposure, missing CRP, stale sources and cross-currency rates', () => {
    const c = context('BR', 'BVMF', 'BRL');
    expect(validateMarketValuation({ context: c, capital }, 'BRL', now)).toEqual([]);
    expect(validateMarketValuation({ context: c, capital: { ...capital, countryRiskPremium: null } }, 'BRL', now).map(i => i.code)).toContain('missing_crp');
    expect(validateMarketValuation({ context: c, capital: { ...capital, currency: 'USD' } }, 'BRL', now).map(i => i.code)).toContain('currency_mismatch');
    expect(validateMarketValuation({ context: c, capital: { ...capital, matureErp: { ...datum(.05), asOf: '2020-01-01' } } }, 'BRL', now).map(i => i.code)).toContain('stale_matureErp');
    expect(validateMarketValuation({ context: c, capital: { ...capital, expectedInflation: null } }, 'BRL', now).map(i => i.code)).toContain('missing_inflation');
  });
});
describe('hand-calculated valuation examples', () => {
  it('uses Fisher conversion and avoids adding CRP twice to debt', () => {
    const result = computeCostOfCapital(capital);
    expect(result.riskFreeRate).toBeCloseTo(.092); // 1.04 × 1.05 − 1
    expect(result.costOfEquity).toBeCloseTo(.182); // .092 + 1.2 × .05 + .03
    expect(result.wacc).toBeCloseTo(.1588); // .8 × .182 + .2 × .1 × .66
    expect(() => computeCostOfCapital({ ...capital, additionalDebtSpread: datum(.03) })).toThrow(/double counted/);
  });
  it('uses dated observed volatility, never an indicative rating table with today as default', () => {
    expect(countryRiskFromSpread(datum(.02), datum(1.5), now).value).toBeCloseTo(.03);
    expect(() => countryRiskFromSpread({ ...datum(.02), asOf: '2020-01-01' }, datum(1.5), now)).toThrow(/stale/);
    expect(() => countryRiskFromSpread({ ...datum(.02), asOf: '2027-01-01' }, datum(1.5), now)).toThrow(/future/);
  });
  it('unlevers and relevers beta with explicit capital weights', () => {
    const result = releverBeta(1.2, 1, .5, .2);
    expect(result.unlevered).toBeCloseTo(2 / 3);
    expect(result.relevered).toBeCloseTo(14 / 15);
    expect(() => releverBeta(1.2, -1, .5, .2)).toThrow(/Invalid/);
  });
  it('keeps FCFE separate from enterprise value and the debt bridge', () => {
    const input = { method: 'FCFF' as const, currency: 'USD', cashFlows: [100, 100], discountRate: .1, terminalGrowth: 0, midYear: false, netDebt: 800, nonOperatingAssets: 0, minorityAndPreferred: 0, shares: 10, terminalExit: null, sourceReferences: ['filing:1'] };
    expect(() => valueCashFlows({ ...input, shares: Infinity })).toThrow();
    expect(valueCashFlows(input).valuePerShare).toBeCloseTo(20); // perpetual 100/.1 − 800, divided by 10
    expect(valueCashFlows({ ...input, method: 'FCFE' }).valuePerShare).toBeCloseTo(100);
    expect(valueCashFlows({ ...input, method: 'FCFE' }).enterpriseValue).toBeNull();
    expect(() => valueCashFlows({ ...input, method: 'FCFE', terminalExit: { kind: 'EV_EBITDA', multiple: 10, metric: 100 } })).toThrow(/inconsistent/);
  });
  it('records duplicate issuer exclusions and valuation disagreements', () => {
    const peer = { ticker: 'AAA', companyName: 'Example AG', currency: 'CHF', financialPeriodEnd: '2025-12-31', sourceUrl: 'https://issuer.example', issuerId: 'LEI:123' };
    const screened = screenMarketPeers([peer, { ...peer, ticker: 'AAA-ADR', currency: 'USD' }]);
    expect(screened.accepted).toHaveLength(1); expect(screened.excluded[0].reason).toContain('ADR');
    expect(reconcileValuations({ currency: 'CHF', valuePerShare: 100 }, { currency: 'CHF', valuePerShare: 150 })[0].code).toBe('dcf_peer_gap');
    expect(reconcileValuations({ currency: 'CHF', valuePerShare: 100 }, { currency: 'USD', valuePerShare: 100 })[0].severity).toBe('BLOCK');
  });
});
