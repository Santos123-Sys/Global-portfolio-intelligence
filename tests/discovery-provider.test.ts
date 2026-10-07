import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/services/provider-gateway', () => ({ getProviderGateway: () => ({ run: ({ perform }: { perform: () => Promise<unknown> }) => perform() }) }));
import { BrapiDiscoveryProvider, FinnhubDiscoveryProvider } from '../src/lib/discovery-provider';

afterEach(() => vi.unstubAllGlobals());
describe('Finnhub discovery coverage', () => {
  it('counts eligible unique listings before capping and never implies ranking', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([
      { symbol: 'AAA.SW', description: 'A', type: 'Common Stock' },
      { symbol: 'AAA.SW', description: 'A', type: 'Common Stock' },
      { symbol: 'FUND.SW', description: 'Fund', type: 'ETF' },
      { symbol: 'BBB.SW', description: 'B', type: 'Common Stock' },
    ])));
    const rows = await new FinnhubDiscoveryProvider('test-key').getSecurityUniverse('XSWX', 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].attributes).toMatchObject({ universe_truncated: true, universe_ranking: 'unranked', universe_eligible_count: 2, universe_selected_count: 1, listing_country: 'Switzerland' });
    expect(rows[0].attributes).not.toHaveProperty('issuer_domicile');
  });
  it('labels an uncapped list as unranked without claiming truncation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([{ symbol: 'AAA.SW', description: 'A', type: 'Common Stock' }])));
    const rows = await new FinnhubDiscoveryProvider('test-key').getSecurityUniverse('XSWX', 25);
    expect(rows[0].attributes.universe_truncated).toBe(false);
    expect(rows[0].attributes.universe_ranking).toBe('unranked');
  });
});

describe('BrAPI B3 discovery coverage', () => {
  it('returns the B3 stock universe ranked by market capitalization', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      stocks: [
        { stock: 'PETR4', name: 'Petrobras PN', type: 'stock', subType: 'stock', close: 36.65, change: -0.95, volume: 27_681_100, market_cap: 483_937_892_568, sector: 'Energy Minerals' },
        { stock: 'PETR3', name: 'Petrobras ON', type: 'stock', subType: 'stock', close: 39.1, change: 0.2, volume: 1_000, market_cap: 483_937_892_568, sector: 'Energy Minerals' },
      ],
      totalCount: 2,
      totalPages: 1,
      hasNextPage: false,
    })));
    const rows = await new BrapiDiscoveryProvider('test-key').getSecurityUniverse('BVMF', 20);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ticker: 'PETR4', exchange: 'BVMF', currency: 'BRL', provider: 'brapi', sector: 'Energy Minerals' });
    expect(rows[0].attributes).toMatchObject({
      latest_close: 36.65,
      day_change_percent: -0.95,
      regular_market_volume: 27_681_100,
      market_capitalization: 483_937_892_568,
      universe_ranking: 'market_cap_desc',
      universe_rank: 1,
      universe_scope: 'b3_listed_stocks',
      universe_complete: true,
      universe_eligible_count: 2,
    });
    const request = new URL(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]));
    expect(request.pathname).toBe('/api/quote/list');
    expect(request.searchParams.get('type')).toBe('stock');
    expect(request.searchParams.get('sortBy')).toBe('market_cap_basic');
    expect(request.searchParams.get('sortOrder')).toBe('desc');
    expect(request.searchParams.get('page')).toBe('1');
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.headers).toMatchObject({ authorization: 'Bearer test-key' });
  });

  it('uses the public B3 list when no BrAPI token is configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      stocks: [{ stock: 'VALE3', name: 'Vale ON', type: 'stock', subType: 'stock', market_cap: 300_000_000_000, sector: 'Non-Energy Minerals' }],
      totalCount: 1, totalPages: 1, hasNextPage: false,
    })));
    const rows = await new BrapiDiscoveryProvider().getSecurityUniverse('BVMF', 20);
    expect(rows).toHaveLength(1);
    const headers = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.accept).toBe('application/json');
    expect(headers.authorization).toBeUndefined();
    expect(rows[0].attributes.universe_ranking).toBe('market_cap_desc');
  });

  it('does not claim BrAPI can supply a non-B3 universe', async () => {
    await expect(new BrapiDiscoveryProvider('test-key').getSecurityUniverse('XSWX', 20)).rejects.toThrow(/B3/);
  });
});