import { describe, expect, it } from 'vitest';
import { emptyThesisPolicy, screenDiscoveryUniverse, type DiscoveryRunRequest, type SecurityUniverseRecord } from '@portfolio-intelligence/agentic-contract';
const swiss = '11111111-1111-4111-8111-111111111111';
const brazil = '22222222-2222-4222-8222-222222222222';
const version = '33333333-3333-4333-8333-333333333333';
const record = (ticker: string, extra: Partial<SecurityUniverseRecord> = {}): SecurityUniverseRecord => ({ ticker, exchange: 'XSWX', companyName: ticker, currency: 'CHF', country: 'CH', sector: 'Industrials', industry: 'Machinery', assetType: 'Common Stock', observedAt: '2026-09-27T00:00:00Z', provider: 'fixture', sourceUrl: 'https://example.test/record', attributes: {}, ...extra });
function request(): DiscoveryRunRequest {
  const policy = emptyThesisPolicy(); policy.universe.listingMarkets = ['XSWX']; policy.universe.sectorsExcluded = ['Financials'];
  return { thesis: { versionId: version, criteria: { version: 1, portfolios: [{ role: 'swiss_quality', currency: 'CHF', objective: 'Quality', inclusionCriteria: [], exclusionCriteria: [], policy }], globalConstraints: [] } }, portfolios: [{ id: swiss, name: 'Swiss', role: 'swiss_quality', baseCurrency: 'CHF', investmentObjective: 'Quality' }], universe: [record('AAA')], maxCandidatesPerPortfolio: 6 };
}
describe('deterministic Discovery screening', () => {
  it('isolates Swiss and Brazilian universes without confusing trading and reporting currencies', () => {
    const req = request();
    req.portfolios.push({ id: brazil, name: 'Brazil', role: 'brazilian_growth', baseCurrency: 'BRL', investmentObjective: 'Growth' });
    const policy = emptyThesisPolicy(); policy.universe.listingMarkets = ['BVMF'];
    req.thesis.criteria.portfolios.push({ role: 'brazilian_growth', currency: 'BRL', objective: 'Growth', inclusionCriteria: [], exclusionCriteria: [], policy });
    req.universe = [record('USD_LISTING', { currency: 'USD' }), record('BR', { exchange: 'BVMF', currency: 'BRL', country: 'BR' })];
    const result = screenDiscoveryUniverse(req);
    expect(result.eligibleByPortfolio.get(swiss)?.map(r => r.ticker)).toEqual(['USD_LISTING']);
    expect(result.eligibleByPortfolio.get(brazil)?.map(r => r.ticker)).toEqual(['BR']);
  });
  it('normalizes known sector aliases and distinguishes unknown data from failure', () => {
    const req = request(); req.universe = [record('BANK', { sector: 'Financial Services' }), record('MISSING', { sector: null }), record('OK')];
    const rows = screenDiscoveryUniverse(req).records;
    expect(rows.map(r => r.status)).toEqual(['ineligible', 'unverified', 'eligible']);
    expect(rows[0].rules.find(r => r.criterion === 'Sector exclusion')?.status).toBe('FAIL');
    expect(rows[1].rules.find(r => r.criterion === 'Sector exclusion')?.status).toBe('UNKNOWN');
  });
  it('never uses a preference or contextual assumption as an exclusion', () => {
    const req = request(); req.thesis.criteria.portfolios[0].policy!.rules = [
      { kind: 'preference', category: 'selection', statement: 'High ROIC', metric: { field: 'roic', operator: 'gte', value: 15, unit: 'percent', period: 'TTM' } },
      { kind: 'context', category: 'macro', statement: 'CHF may appreciate' },
    ];
    expect(screenDiscoveryUniverse(req).records[0].status).toBe('eligible');
  });
  it('keeps domicile, listing, operating and revenue geography distinct', () => {
    const req = request(); const u = req.thesis.criteria.portfolios[0].policy!.universe;
    u.domicileCountries = ['CH']; u.revenueCountries = ['US']; u.operatingCountries = ['BR'];
    req.universe[0].attributes = { issuer_domicile_country_iso2: 'CH', revenue_country_iso2: 'US', operating_country_iso2: 'BR' };
    expect(screenDiscoveryUniverse(req).records[0].status).toBe('eligible');
    delete req.universe[0].attributes.issuer_domicile_country_iso2;
    expect(screenDiscoveryUniverse(req).records[0].status).toBe('unverified');
  });
  it('requires identical numeric units and periods; missing values never become zero', () => {
    const req = request(); req.thesis.criteria.portfolios[0].policy!.rules = [{ kind: 'hard', category: 'risk', statement: 'Leverage limit', metric: { field: 'leverage', operator: 'lte', value: 3, unit: 'x', period: 'FY2025' } }];
    req.universe[0].attributes = { leverage: 2, leverage_unit: 'x', leverage_period: 'TTM' };
    expect(screenDiscoveryUniverse(req).records[0].status).toBe('unverified');
    req.universe[0].attributes.leverage_period = 'FY2025';
    expect(screenDiscoveryUniverse(req).records[0].status).toBe('eligible');
    req.universe[0].attributes.leverage = 4;
    expect(screenDiscoveryUniverse(req).records[0].status).toBe('ineligible');
  });
  it('chooses the primary eligible issuer listing and retains duplicate audit rows', () => {
    const req = request(); req.universe = [record('A', { attributes: { issuer_lei: 'SAME' } }), record('Z', { attributes: { issuer_lei: 'SAME', listing_primary_status: 'Yes' } })];
    expect(screenDiscoveryUniverse(req).eligibleByPortfolio.get(swiss)?.map(r => r.ticker)).toEqual(['Z']);
    expect(screenDiscoveryUniverse(req).records.find(r => r.ticker === 'A')?.status).toBe('duplicate');
  });
  it('suppresses holdings and active candidates only within their portfolio; reconsiders rejection after a thesis change', () => {
    const req = request(); req.knownSecurities = [{ portfolioId: brazil, ticker: 'AAA', exchange: 'XSWX', reason: 'held' }];
    expect(screenDiscoveryUniverse(req).records[0].status).toBe('eligible');
    req.knownSecurities[0].portfolioId = swiss;
    expect(screenDiscoveryUniverse(req).records[0].status).toBe('already_known');
    req.knownSecurities[0] = { portfolioId: swiss, ticker: 'AAA', exchange: 'XSWX', reason: 'rejected', thesisVersionId: version };
    expect(screenDiscoveryUniverse(req).records[0].status).toBe('already_known');
    req.thesis.versionId = '44444444-4444-4444-8444-444444444444';
    expect(screenDiscoveryUniverse(req).records[0].status).toBe('eligible');
  });
});

it('screens a broad universe before applying the research budget and preserves deferred eligibility', () => {
  const req = request(); req.researchBudgetPerPortfolio = 2;
  req.universe = Array.from({ length: 600 }, (_, i) => record(`T${String(i).padStart(4, '0')}`, { sector: i < 590 ? 'Financials' : 'Industrials' }));
  const output = screenDiscoveryUniverse(req);
  expect(output.records).toHaveLength(600);
  expect(output.eligibleByPortfolio.get(swiss)?.map(r => r.ticker)).toEqual(['T0590', 'T0591']);
  expect(output.records.filter(r => r.status === 'ineligible')).toHaveLength(590);
  expect(output.records.filter(r => r.status === 'budget_deferred')).toHaveLength(8);
  expect(screenDiscoveryUniverse(req).records).toEqual(output.records);
});
