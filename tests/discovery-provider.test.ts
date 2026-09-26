import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/services/provider-gateway', () => ({ getProviderGateway: () => ({ run: ({ perform }: { perform: () => Promise<unknown> }) => perform() }) }));
import { FinnhubDiscoveryProvider } from '../src/lib/discovery-provider';

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
