import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { portfolios, positions, securities } from './db/schema';

export const hashSnapshot = (value: string) => createHash('sha256').update(value).digest('hex');
export async function weightUniverse(ownerId: string, portfolioId: string) {
  const [portfolio] = await db.select().from(portfolios).where(and(eq(portfolios.id, portfolioId), eq(portfolios.ownerId, ownerId))).limit(1);
  if (!portfolio) throw new Error('Portfolio not found');
  const holdings = await db.select({ id: securities.id, ticker: securities.ticker, currency: securities.currency })
    .from(positions).innerJoin(securities, eq(positions.securityId, securities.id)).where(eq(positions.portfolioId, portfolioId));
  holdings.sort((a, b) => a.id.localeCompare(b.id));
  if (holdings.length < 2 || holdings.length > 12 || new Set(holdings.map(h => h.ticker)).size !== holdings.length)
    throw new Error('Allocation needs 2–12 holdings with unique tickers');
  if (holdings.some(h => h.currency !== portfolio.baseCurrency)) throw new Error('Every holding must use the portfolio native currency');
  return { portfolio, assets: holdings.map(h => h.ticker), holdingsHash: hashSnapshot(JSON.stringify(holdings)) };
}

export async function callWeightEngine(action: 'compute' | 'finalize', payload: unknown): Promise<unknown> {
  const base = process.env.FILINGS_API_URL;
  const token = process.env.FILINGS_INTERNAL_TOKEN;
  if (!base || !token || token.length < 32) throw new Error('Allocation service is not configured. Deploy the updated Python service and configure FILINGS_API_URL and FILINGS_INTERNAL_TOKEN.');
  const response = await fetch(new URL(`/v1/portfolio-weights/${action}`, base), {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(action === 'compute' ? 110_000 : 15_000), cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Allocation service unavailable (${response.status})`);
  return data;
}
