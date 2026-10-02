import { SecurityUniverseRecord, type SecurityUniverseRecord as SecurityUniverseRecordType } from '@portfolio-intelligence/agentic-contract';
import { and, eq, gt } from 'drizzle-orm';
import { db } from './db';
import { discoveryUniverseSnapshots } from './db/workflow-schema';
import { getEnv } from './env';
import { EodhdProvider } from './connectors/eodhd';
import { getProviderGateway } from './services/provider-gateway';
import { mergeResearchUniverse } from './research-universe';

export interface MarketDiscoveryProvider {
  readonly name: 'brapi' | 'eodhd' | 'finnhub';
  getSecurityUniverse(exchange: string, limit: number): Promise<SecurityUniverseRecordType[]>;
}

const EXCHANGE_INFO: Record<string, { finnhubCode: string; currency: string; country: string }> = {
  XSWX: { finnhubCode: 'SW', currency: 'CHF', country: 'Switzerland' },
  BVMF: { finnhubCode: 'SA', currency: 'BRL', country: 'Brazil' },
};

function marketLabel(exchange: string): string {
  if (exchange === 'BVMF') return 'Brazilian B3 market (BVMF)';
  if (exchange === 'XSWX') return 'Swiss SIX market (XSWX)';
  return exchange;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown provider error';
}

const NON_EQUITY = ['etf', 'fund', 'bond', 'index', 'currency', 'warrant', 'right'];

function finite(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function toRecord(row: Record<string, unknown>, exchange: string): SecurityUniverseRecordType | null {
  const info = EXCHANGE_INFO[exchange];
  const symbol = typeof row.symbol === 'string' ? row.symbol.trim() : '';
  const companyName = typeof row.description === 'string' ? row.description.trim() : '';
  const assetType = typeof row.type === 'string' && row.type.trim() ? row.type : 'Listed Equity';
  if (!info || !symbol || !companyName || NON_EQUITY.some((item) => assetType.toLowerCase().includes(item))) return null;
  const ticker = symbol.replace(/\.(SW|SA)$/i, '').toUpperCase();
  const attributes: SecurityUniverseRecordType['attributes'] = { provider_symbol: symbol };
  const mic = typeof row.mic === 'string' ? row.mic : undefined;
  if (mic) attributes.provider_mic = mic;
  const figi = typeof row.figi === 'string' ? row.figi : undefined;
  if (figi) attributes.figi = figi;
  const isin = typeof row.isin === 'string' ? row.isin : undefined;
  if (isin) attributes.isin = isin;
  const marketCap = finite(row.marketCapitalization ?? row.market_capitalization);
  if (marketCap != null) attributes.market_capitalization = marketCap;
  return {
    ticker,
    exchange,
    companyName,
    currency: typeof row.currency === 'string' && row.currency ? row.currency : info.currency,
    country: info.country,
    sector: typeof row.sector === 'string' ? row.sector : null,
    industry: typeof row.industry === 'string' ? row.industry : null,
    assetType,
    observedAt: new Date().toISOString(),
    provider: 'finnhub',
    sourceUrl: 'https://finnhub.io/docs/api/stock-symbols',
    attributes,
  };
}

export class FinnhubDiscoveryProvider implements MarketDiscoveryProvider {
  readonly name = 'finnhub' as const;
  constructor(private readonly apiKey: string) {}

  async getSecurityUniverse(exchange: string, limit: number): Promise<SecurityUniverseRecordType[]> {
    const info = EXCHANGE_INFO[exchange];
    if (!info) throw new Error(`Finnhub exchange mapping is not configured for ${exchange}`);
    const endpoint = '/api/v1/stock/symbol';
    const raw = await getProviderGateway().run({
      provider: this.name,
      endpoint,
      perform: async () => {
        const url = new URL(`https://finnhub.io${endpoint}`);
        url.searchParams.set('exchange', info.finnhubCode);
        url.searchParams.set('token', this.apiKey);
        const response = await fetch(url, { headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error(`Finnhub stock-symbol request failed: ${response.status} ${response.statusText}`);
        return response.json();
      },
      classify: () => ({ outcome: 'ok', httpStatus: 200 }),
    });
    if (!Array.isArray(raw)) throw new Error(`Finnhub returned an invalid symbol list for ${exchange}`);
    const eligible = raw
      .flatMap((value) => value && typeof value === 'object' ? [toRecord(value as Record<string, unknown>, exchange)] : [])
      .filter((value): value is SecurityUniverseRecordType => value !== null);
    const unique = [...new Map(eligible.map(record => [`${record.exchange}:${record.ticker}`, record])).values()];
    const selected = unique.slice(0, Math.max(1, Math.min(limit, 4000)));
    return selected.map(record => ({ ...record, attributes: {
      ...record.attributes,
      universe_truncated: unique.length > selected.length,
      universe_ranking: 'unranked',
      universe_eligible_count: unique.length,
      universe_selected_count: selected.length,
      listing_country: info.country,
    } }));
  }
}

type BrapiListResponse = {
  stocks?: unknown[];
  currentPage?: unknown;
  totalPages?: unknown;
  totalCount?: unknown;
  hasNextPage?: unknown;
};

function brapiRecord(row: Record<string, unknown>): SecurityUniverseRecordType | null {
  const ticker = typeof row.stock === 'string' ? row.stock.trim().toUpperCase() : '';
  const companyName = typeof row.name === 'string' ? row.name.trim() : '';
  const assetType = typeof row.type === 'string' && row.type.trim() ? row.type.trim() : 'stock';
  const subType = typeof row.subType === 'string' ? row.subType.trim().toLowerCase() : '';
  if (!ticker || !companyName || assetType.toLowerCase() !== 'stock' || (subType && !['stock', 'unit'].includes(subType))) return null;

  const attributes: SecurityUniverseRecordType['attributes'] = {
    provider_symbol: ticker,
    listing_country: 'Brazil',
  };
  const close = finite(row.close);
  const change = finite(row.change);
  const volume = finite(row.volume);
  const marketCap = finite(row.market_cap ?? row.marketCap);
  if (close != null) attributes.latest_close = close;
  if (change != null) attributes.day_change_percent = change;
  if (volume != null) attributes.regular_market_volume = volume;
  if (marketCap != null) attributes.market_capitalization = marketCap;
  if (subType) attributes.listing_subtype = subType;

  return {
    ticker,
    exchange: 'BVMF',
    companyName,
    currency: 'BRL',
    country: 'Brazil',
    sector: typeof row.sector === 'string' && row.sector.trim() ? row.sector.trim() : null,
    industry: null,
    assetType: subType || assetType,
    observedAt: new Date().toISOString(),
    provider: 'brapi',
    sourceUrl: 'https://brapi.dev/docs/acoes/list',
    attributes,
  };
}

/**
 * BrAPI's B3 list endpoint is the primary Brazil universe. It contains the
 * listing identity together with current close, change, volume and market cap,
 * so discovery need not spend EODHD entitlement on the same first pass.
 */
export class BrapiDiscoveryProvider implements MarketDiscoveryProvider {
  readonly name = 'brapi' as const;
  constructor(private readonly apiKey: string) {}

  async getSecurityUniverse(exchange: string, limit: number): Promise<SecurityUniverseRecordType[]> {
    if (exchange !== 'BVMF') throw new Error(`BrAPI only supports the Brazilian B3 universe, not ${exchange}`);
    const cappedLimit = Math.max(1, Math.min(limit, 4_000));
    const pageSize = Math.min(100, cappedLimit);
    const rows: SecurityUniverseRecordType[] = [];
    let page = 1;
    let totalCount: number | null = null;
    let hasNextPage = true;

    while (hasNextPage && rows.length < cappedLimit) {
      const payload = await getProviderGateway().run({
        provider: this.name,
        endpoint: '/api/quote/list',
        perform: async () => {
          const url = new URL('https://brapi.dev/api/quote/list');
          url.searchParams.set('type', 'stock');
          url.searchParams.set('page', String(page));
          url.searchParams.set('limit', String(pageSize));
          const response = await fetch(url, {
            headers: { accept: 'application/json', authorization: `Bearer ${this.apiKey}` },
            signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) throw new Error(`BrAPI B3 listing request failed: ${response.status} ${response.statusText}`);
          return response.json() as Promise<BrapiListResponse>;
        },
        classify: () => ({ outcome: 'ok', httpStatus: 200 }),
      });

      const stockRows = Array.isArray(payload.stocks) ? payload.stocks : [];
      const normalized = stockRows.flatMap((value) => value && typeof value === 'object'
        ? [brapiRecord(value as Record<string, unknown>)] : [])
        .filter((value): value is SecurityUniverseRecordType => value !== null);
      rows.push(...normalized);

      const reportedTotal = finite(payload.totalCount);
      if (reportedTotal != null) totalCount = reportedTotal;
      const reportedPages = finite(payload.totalPages);
      hasNextPage = payload.hasNextPage === true || (reportedPages != null && page < reportedPages);
      if (stockRows.length === 0) hasNextPage = false;
      page += 1;
    }

    const unique = [...new Map(rows.map((record) => [`${record.exchange}:${record.ticker}`, record])).values()];
    const selected = unique.slice(0, cappedLimit);
    const eligibleCount = totalCount ?? unique.length;
    return selected.map((record) => ({
      ...record,
      attributes: {
        ...record.attributes,
        universe_truncated: eligibleCount > selected.length,
        universe_ranking: 'unranked',
        universe_eligible_count: eligibleCount,
        universe_selected_count: selected.length,
      },
    }));
  }
}

class EodhdDiscoveryProvider implements MarketDiscoveryProvider {
  readonly name = 'eodhd' as const;
  constructor(private readonly provider: EodhdProvider) {}
  getSecurityUniverse(exchange: string, limit: number) {
    return this.provider.getSecurityUniverse(exchange, limit);
  }
}

export function getDiscoveryProvider(exchange?: string): MarketDiscoveryProvider {
  const env = getEnv();
  if (exchange === 'BVMF') {
    if (!env.BRAPI_API_KEY) throw new Error('BRAPI_API_KEY is required for the Brazilian B3 discovery universe');
    return new BrapiDiscoveryProvider(env.BRAPI_API_KEY);
  }
  if (env.DISCOVERY_PROVIDER === 'finnhub') {
    if (!env.FINNHUB_API_KEY) throw new Error('FINNHUB_API_KEY is required when DISCOVERY_PROVIDER=finnhub');
    return new FinnhubDiscoveryProvider(env.FINNHUB_API_KEY);
  }
  if (!env.MARKET_DATA_API_KEY) throw new Error('MARKET_DATA_API_KEY is required when DISCOVERY_PROVIDER=eodhd');
  return new EodhdDiscoveryProvider(new EodhdProvider(env.MARKET_DATA_API_KEY, getProviderGateway()));
}

/** Only the bounded, eligible research queue gets issuer-profile calls. */
export async function enrichDiscoveryIssuerSources(records: SecurityUniverseRecordType[]): Promise<SecurityUniverseRecordType[]> {
  const env = getEnv();
  const eodhd = env.MARKET_DATA_API_KEY ? new EodhdProvider(env.MARKET_DATA_API_KEY, getProviderGateway()) : null;
  const enriched = [...records];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(8, records.length) }, async () => {
    while (cursor < records.length) {
      const index = cursor++;
      const record = records[index];
      if (typeof record.attributes.issuer_website === 'string') continue;
      try {
        let profile: { name?: string | null; isin?: string | null; website?: string | null } | null = null;
        if (record.provider === 'eodhd' && eodhd) profile = await eodhd.getDiscoveryIssuerProfile(record.ticker, record.exchange);
        else if (record.provider === 'finnhub' && env.FINNHUB_API_KEY) {
          const url = new URL('https://finnhub.io/api/v1/stock/profile2');
          url.searchParams.set('symbol', String(record.attributes.provider_symbol ?? record.ticker));
          const response = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { 'X-Finnhub-Token': env.FINNHUB_API_KEY } });
          if (response.ok) {
            const raw = await response.json() as Record<string, unknown>;
            profile = { name: typeof raw.name === 'string' ? raw.name : '', website: typeof raw.weburl === 'string' ? raw.weburl : '' };
          }
        }
        if (!profile?.website) continue;
        const source = new URL(profile.website);
        if (source.protocol !== 'https:' || source.username || source.password || source.port && source.port !== '443') continue;
        const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const sameIssuer = profile.isin && profile.isin === record.attributes.isin
          || profile.name && normalize(profile.name) === normalize(record.companyName);
        if (!sameIssuer) continue;
        enriched[index] = { ...record, attributes: { ...record.attributes, issuer_website: source.href,
          issuer_website_provider: record.provider, issuer_profile_name: profile.name ?? null } };
      } catch { /* Identity or source unavailable. The service reports a research gap. */ }
    }
  }));
  return enriched;
}

async function cachedUniverse(provider: string, exchange: string): Promise<SecurityUniverseRecordType[] | null> {
  const [snapshot] = await db.select().from(discoveryUniverseSnapshots).where(and(
    eq(discoveryUniverseSnapshots.provider, provider),
    eq(discoveryUniverseSnapshots.exchange, exchange),
    gt(discoveryUniverseSnapshots.expiresAt, new Date())
  )).limit(1);
  if (!snapshot) return null;
  const parsed = SecurityUniverseRecord.array().safeParse(snapshot.recordsJson);
  return parsed.success ? parsed.data : null;
}

async function saveUniverse(provider: string, exchange: string, records: SecurityUniverseRecordType[]): Promise<void> {
  const hours = getEnv().DISCOVERY_UNIVERSE_CACHE_HOURS;
  await db.insert(discoveryUniverseSnapshots).values({
    provider,
    exchange,
    recordsJson: records,
    expiresAt: new Date(Date.now() + hours * 3_600_000),
  }).onConflictDoUpdate({
    target: [discoveryUniverseSnapshots.provider, discoveryUniverseSnapshots.exchange],
    set: { recordsJson: records, fetchedAt: new Date(), expiresAt: new Date(Date.now() + hours * 3_600_000) },
  });
}

/**
 * Reads live data first and falls back only to a non-expired snapshot. There is
 * deliberately no stub fallback: a stale-but-labelled universe is preferable
 * to invented securities.
 */
export async function loadDiscoveryUniverse(exchange: string, limit: number): Promise<{ records: SecurityUniverseRecordType[]; provider: string; cached: boolean }> {
  const env = getEnv();
  // Resolve the configured provider inside the guarded block. In particular,
  // a missing BrAPI key must still allow the explicitly configured EODHD
  // fallback to serve a B3 universe.
  const primaryName = exchange === 'BVMF' ? 'brapi' : env.DISCOVERY_PROVIDER;
  let primaryError: unknown;
  try {
    const primary = getDiscoveryProvider(exchange);
    const records = await primary.getSecurityUniverse(exchange, limit);
    if (!records.length) throw new Error(`${primary.name} returned an empty security universe`);
    await saveUniverse(primary.name, exchange, records);
    return { records: mergeResearchUniverse(records, exchange), provider: primary.name, cached: false };
  } catch (error) {
    primaryError = error;
  }

  try {
    const cached = await cachedUniverse(primaryName, exchange);
    if (cached?.length) return { records: mergeResearchUniverse(cached.slice(0, limit), exchange), provider: primaryName, cached: true };
  } catch { /* A cache outage must not prevent trying the configured live fallback. */ }

  if (env.DISCOVERY_FALLBACK_PROVIDER === 'eodhd' && primaryName !== 'eodhd') {
    if (!env.MARKET_DATA_API_KEY) {
      throw new Error(
        `${marketLabel(exchange)} could not be loaded from ${primaryName}: ${errorMessage(primaryError)}. ` +
        'EODHD fallback is enabled but MARKET_DATA_API_KEY is not configured on the dashboard service.'
      );
    }
    const fallback = new EodhdDiscoveryProvider(new EodhdProvider(env.MARKET_DATA_API_KEY, getProviderGateway()));
    try {
      const records = await fallback.getSecurityUniverse(exchange, limit);
      if (!records.length) throw new Error('EODHD returned an empty security universe');
      await saveUniverse(fallback.name, exchange, records);
      return { records: mergeResearchUniverse(records, exchange), provider: fallback.name, cached: false };
    } catch (fallbackError) {
      throw new Error(
        `${marketLabel(exchange)} could not be loaded. ${primaryName}: ${errorMessage(primaryError)}. ` +
        `EODHD fallback: ${errorMessage(fallbackError)}`
      );
    }
  }

  throw new Error(`${marketLabel(exchange)} could not be loaded from ${primaryName}: ${errorMessage(primaryError)}`);
}
