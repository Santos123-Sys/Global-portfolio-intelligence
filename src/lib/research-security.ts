import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { priceHistory, securities } from './db/schema';
import { marketDataObservations } from './db/workflow-schema';
import { getEnv } from './env';
import { FmpProvider, type FmpFinancialPeriod, type FmpProfile } from './connectors/fmp';
import { getProviderGateway } from './services/provider-gateway';

function normalizedQuery(value: string) {
  return value.trim().toUpperCase().replace(/\.(SW|SA)$/i, '');
}

async function localSecurity(query: string) {
  const ticker = normalizedQuery(query);
  const [row] = await db.select().from(securities).where(eq(securities.ticker, ticker)).limit(1);
  return row ?? null;
}

function sourceForPeriod(profile: FmpProfile, period: FmpFinancialPeriod) {
  const url = new URL('https://financialmodelingprep.com/stable/income-statement');
  url.searchParams.set('symbol', profile.symbol);
  url.searchParams.set('period', 'annual');
  url.searchParams.set('date', period.date);
  return url.toString();
}

async function persistFinancialHistory(securityId: string, profile: FmpProfile, periods: FmpFinancialPeriod[]) {
  const retrievedAt = new Date();
  const observations = periods.flatMap(period => Object.entries(period.metrics).map(([metricName, value]) => ({
    securityId,
    observationType: 'fundamental',
    metricName,
    valueNumeric: String(value),
    valueText: null,
    currency: period.currency,
    observationDate: period.date,
    retrievedAt,
    provider: 'fmp',
    sourceName: 'Financial Modeling Prep annual financial statements',
    sourceUrl: sourceForPeriod(profile, period),
    query: profile.symbol,
    status: 'OK',
    evidenceSnippet: `${profile.companyName} ${period.date} ${metricName}=${value} ${period.currency}`,
    rawPayload: { symbol: profile.symbol, fiscalYear: period.fiscalYear, period: period.period, metricName, value },
  })));
  if (profile.marketCap != null) observations.push({
    securityId,
    observationType: 'fundamental',
    metricName: 'market_capitalization',
    valueNumeric: String(profile.marketCap),
    valueText: null,
    currency: profile.currency,
    observationDate: new Date().toISOString().slice(0, 10),
    retrievedAt,
    provider: 'fmp',
    sourceName: 'Financial Modeling Prep company profile',
    sourceUrl: `https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(profile.symbol)}`,
    query: profile.symbol,
    status: 'OK',
    evidenceSnippet: `${profile.companyName} market capitalization ${profile.marketCap} ${profile.currency}`,
    rawPayload: { symbol: profile.symbol, marketCap: profile.marketCap },
  });
  if (observations.length) await db.insert(marketDataObservations).values(observations);
}

async function hydrateSecurity(profile: FmpProfile, provider: FmpProvider) {
  const [security] = await db.insert(securities).values({
    ticker: profile.ticker,
    companyName: profile.companyName,
    exchange: profile.exchange,
    currency: profile.currency,
    sector: profile.sector,
    industry: profile.industry,
    country: profile.country,
    isin: profile.isin,
  }).onConflictDoUpdate({
    target: [securities.ticker, securities.exchange],
    set: {
      companyName: profile.companyName,
      currency: profile.currency,
      sector: profile.sector,
      industry: profile.industry,
      country: profile.country,
      isin: profile.isin,
    },
  }).returning();

  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10);
  const [barsResult, periodsResult] = await Promise.allSettled([
    provider.getDailyBars(profile.ticker, profile.exchange, fromDate, to),
    provider.getAnnualFinancialHistory(profile.ticker, profile.exchange, 6),
  ]);

  if (barsResult.status === 'fulfilled' && barsResult.value.length) {
    await db.insert(priceHistory).values(barsResult.value.map(bar => ({
      securityId: security.id,
      priceDate: bar.date,
      close: String(bar.close),
      currency: bar.currency,
      source: 'fmp',
      volume: bar.volume == null ? null : String(bar.volume),
    }))).onConflictDoUpdate({
      target: [priceHistory.securityId, priceHistory.priceDate],
      set: { close: String(barsResult.value.at(-1)?.close ?? 0), fetchedAt: new Date() },
    });
  }
  if (periodsResult.status === 'fulfilled') await persistFinancialHistory(security.id, profile, periodsResult.value);

  return {
    security,
    hydration: {
      prices: barsResult.status === 'fulfilled' ? barsResult.value.length : 0,
      financialPeriods: periodsResult.status === 'fulfilled' ? periodsResult.value.length : 0,
      priceError: barsResult.status === 'rejected' ? (barsResult.reason instanceof Error ? barsResult.reason.message : 'Price history unavailable') : null,
      financialError: periodsResult.status === 'rejected' ? (periodsResult.reason instanceof Error ? periodsResult.reason.message : 'Financial statements unavailable') : null,
    },
  };
}

/**
 * Resolves a free-form company name or ticker without requiring Discovery.
 * Existing local securities are reused. New companies are identified and
 * hydrated through FMP before the normal governed research session is queued.
 */
export async function resolveSecurityForResearch(query: string) {
  const local = await localSecurity(query);
  if (local) return { security: local, resolvedBy: 'local' as const, hydration: null };

  const env = getEnv();
  if (!env.FMP_API_KEY) throw new Error('FMP_API_KEY is required to research a company that is not already in the local security universe.');
  const provider = new FmpProvider(env.FMP_API_KEY, getProviderGateway());
  const profile = await provider.resolveCompany(query);
  if (!profile) throw new Error(`Financial Modeling Prep could not resolve “${query}”. Try the exact ticker or company name.`);
  const hydrated = await hydrateSecurity(profile, provider);
  return { ...hydrated, resolvedBy: 'fmp' as const };
}
