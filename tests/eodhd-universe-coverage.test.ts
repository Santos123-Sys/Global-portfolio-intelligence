import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../src/lib/services/provider-gateway', () => ({ getProviderGateway: () => ({ run: (call: { perform: () => unknown }) => call.perform() }) }));
import { EodhdProvider } from '../src/lib/connectors/eodhd';
import { enrichDiscoveryIssuerSources } from '../src/lib/discovery-provider';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const listings = Array.from({ length: 220 }, (_, i) => ({ Code: `S${i}`, Name: `Issuer ${i}`, Type: 'Common Stock', Currency: 'CHF' }));
it('keeps an exchange directory while paging optional EODHD metrics within the documented offset cap', async () => {
  const offsets: number[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname.includes('exchange-symbol-list')) return Response.json(listings);
    if (url.pathname.includes('eod-bulk-last-day')) return Response.json([]);
    if (url.pathname.includes('screener')) {
      const offset = Number(url.searchParams.get('offset')); offsets.push(offset);
      return Response.json({ data: listings.slice(offset, offset + Number(url.searchParams.get('limit'))).map(row => ({ code: row.Code, name: row.Name, sector: 'Industrials' })) });
    }
    return Response.json([], { status: 404 });
  }));
  const records = await new EodhdProvider('test-key').getSecurityUniverse('XSWX', 220);
  expect(records).toHaveLength(220); expect(offsets).toEqual([0, 100, 200]);
  expect(records.at(-1)?.sector).toBe('Industrials');
  expect(records[0].attributes).toMatchObject({ universe_eligible_count: 220, universe_selected_count: 220, universe_truncated: false });
});
it('preserves the larger directory and labels enrichment failure', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname.includes('exchange-symbol-list')) return Response.json(listings);
    if (url.pathname.includes('eod-bulk-last-day')) return Response.json([]);
    return Response.json({}, { status: 403 });
  }));
  const records = await new EodhdProvider('test-key').getSecurityUniverse('XSWX', 220);
  expect(records).toHaveLength(220); expect(records[0].attributes.financial_enrichment_status).toBe('unavailable');
  expect(records[0].attributes.market_capitalization).toBeUndefined();
});

it('looks up a provider-grounded issuer URL only for eligible research records', async () => {
  vi.stubEnv('MARKET_DATA_API_KEY', 'test-key');
  vi.stubEnv('DATABASE_URL', 'postgres://test:test@localhost:5432/test');
  vi.stubEnv('SESSION_SECRET', 'x'.repeat(32));
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname.includes('/fundamentals/')) return Response.json({ General: {
      Name: 'Issuer 1', ISIN: 'CH0000000001', WebURL: 'https://issuer.example/investors',
    } });
    return Response.json([], { status: 404 });
  }));
  const selected: Parameters<typeof enrichDiscoveryIssuerSources>[0][number] = {
    ticker: 'S1', exchange: 'XSWX', companyName: 'Issuer 1', provider: 'eodhd', currency: 'CHF', country: 'CH',
    sector: null, industry: null, assetType: 'Common Stock', observedAt: new Date().toISOString(),
    sourceUrl: 'https://eodhd.com/financial-apis/', attributes: { isin: 'CH0000000001' },
  };
  const [record] = await enrichDiscoveryIssuerSources([selected]);
  expect(record.attributes.issuer_website).toBe('https://issuer.example/investors');
  expect(fetch).toHaveBeenCalledTimes(1);
});
