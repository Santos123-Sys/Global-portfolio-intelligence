import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  select: vi.fn(),
  insert: vi.fn(),
  eodhdUniverse: vi.fn(),
}));

vi.mock('../src/lib/env', () => ({ getEnv: () => mocks.env }));
vi.mock('../src/lib/db', () => ({ db: { select: mocks.select, insert: mocks.insert } }));
vi.mock('../src/lib/connectors/eodhd', () => ({
  EodhdProvider: class {
    getSecurityUniverse(exchange: string, limit: number) {
      return mocks.eodhdUniverse(exchange, limit);
    }
  },
}));
vi.mock('../src/lib/services/provider-gateway', () => ({
  getProviderGateway: () => ({ run: ({ perform }: { perform: () => Promise<unknown> }) => perform() }),
}));

import { loadDiscoveryUniverse } from '../src/lib/discovery-provider';

const fallbackListing = {
  ticker: 'PETR4', exchange: 'BVMF', companyName: 'Petrobras PN', currency: 'BRL', country: 'Brazil',
  sector: null, industry: null, assetType: 'Common Stock', observedAt: '2026-10-02T00:00:00.000Z',
  provider: 'eodhd', sourceUrl: 'https://eodhd.com', attributes: {},
};

function query(rows: unknown[] = []) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    limit: async () => rows,
  };
  return chain;
}

beforeEach(() => {
  mocks.env = {
    BRAPI_API_KEY: 'brapi-key',
    MARKET_DATA_API_KEY: 'eodhd-key',
    DISCOVERY_PROVIDER: 'finnhub',
    DISCOVERY_FALLBACK_PROVIDER: 'eodhd',
    DISCOVERY_UNIVERSE_CACHE_HOURS: 168,
  };
  mocks.select.mockImplementation(() => query());
  mocks.insert.mockImplementation(() => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }));
  mocks.eodhdUniverse.mockResolvedValue([fallbackListing]);
});

afterEach(() => vi.unstubAllGlobals());

describe('B3 discovery fallback', () => {
  it('uses configured EODHD fallback when the dashboard BrAPI key is missing', async () => {
    delete mocks.env.BRAPI_API_KEY;

    const result = await loadDiscoveryUniverse('BVMF', 2000);

    expect(result.provider).toBe('eodhd');
    expect(result.records.some(record => record.ticker === 'PETR4')).toBe(true);
    expect(mocks.eodhdUniverse).toHaveBeenCalledWith('BVMF', 2000);
  });

  it('uses configured EODHD fallback when BrAPI returns no eligible listings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ stocks: [], totalCount: 0 })));

    const result = await loadDiscoveryUniverse('BVMF', 2000);

    expect(result.provider).toBe('eodhd');
    expect(mocks.eodhdUniverse).toHaveBeenCalledWith('BVMF', 2000);
  });

  it('reports that the missing fallback key must be configured on the dashboard service', async () => {
    delete mocks.env.BRAPI_API_KEY;
    delete mocks.env.MARKET_DATA_API_KEY;

    await expect(loadDiscoveryUniverse('BVMF', 2000)).rejects.toThrow(/BRAPI_API_KEY.*MARKET_DATA_API_KEY.*dashboard service/);
  });
});
