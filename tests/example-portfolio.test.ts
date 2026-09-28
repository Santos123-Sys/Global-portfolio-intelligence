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
    }
  });

  it('requires authentication before contacting the private service', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    auth.mockResolvedValueOnce({ ok: false, response: new Response('Authentication required', { status: 401 }) });
    expect((await GET(request)).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('refuses unavailable compute service without fabricating recommendations', async () => {
    auth.mockResolvedValueOnce({ ok: true, auth: { userId: 'example' } });
    const previous = process.env.FILINGS_API_URL;
    delete process.env.FILINGS_API_URL;
    try {
      const response = await GET(request);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'The allocation engine is not configured.' });
    } finally {
      if (previous !== undefined) process.env.FILINGS_API_URL = previous;
    }
  });
});
