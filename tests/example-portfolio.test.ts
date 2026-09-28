import { describe, expect, it, vi } from 'vitest';
import { examplePortfolio } from '../src/lib/example-portfolio';

const auth = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/api-auth', () => ({ authenticateRequest: auth }));
import { GET } from '../src/app/api/example-portfolio/route';

const request = new Request('http://localhost/api/example-portfolio');

describe('isolated example portfolio', () => {
  it('uses fictional identifiers and calculates FCFF from the supplied scenario inputs', () => {
    expect(examplePortfolio.assets).toHaveLength(6);
    expect(examplePortfolio.assets.reduce((sum, asset) => sum + asset.startingWeight, 0)).toBeCloseTo(1);
    expect(new Set(examplePortfolio.assets.map(asset => asset.sector)).size).toBe(6);
    for (const asset of examplePortfolio.assets) {
      expect(asset.ticker).toMatch(/^DEMO-/);
      expect(asset.researchStatus).toBe('illustrative_scenario');
      expect(asset.fcff).toBeCloseTo(asset.ebit * (1 - asset.taxRate) + asset.depreciation - asset.capex - asset.workingCapital);
      expect(asset.revenueGrowth).toBeCloseTo(asset.revenue / asset.revenuePrior - 1);
      expect(asset.dcf.scenarios.map(scenario => scenario.name)).toEqual(['worst_case', 'base_case', 'optimistic_case']);
      expect(asset.dcf.scenarios.every(scenario => scenario.result.projections.length === 5)).toBe(true);
      expect(asset.dcf.scenarios[0]!.result.fairValuePerShare).toBeLessThan(asset.dcf.scenarios[1]!.result.fairValuePerShare);
      expect(asset.dcf.scenarios[1]!.result.fairValuePerShare).toBeLessThan(asset.dcf.scenarios[2]!.result.fairValuePerShare);
    }
  });

  it('requires authentication before serving the sample allocation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    auth.mockResolvedValueOnce({ ok: false, response: new Response('Authentication required', { status: 401 }) });
    expect((await GET(request)).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('serves the already-computed seeded sample allocation without the private service', async () => {
    auth.mockResolvedValueOnce({ ok: true, auth: { userId: 'example' } });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    delete process.env.FILINGS_API_URL;
    const response = await GET(request);
    expect(response.status).toBe(200);
    const { result } = await response.json();
    expect(result.data_kind).toBe('synthetic_educational_example');
    expect(result.recommendation.user_must_choose).toBe(true);
    expect(Object.keys(result.weights_table)).toHaveLength(8);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
