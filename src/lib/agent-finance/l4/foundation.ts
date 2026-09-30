import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { priceHistory, securities } from '@/lib/db/schema';
import { intelligenceDocuments, marketDataObservations } from '@/lib/db/workflow-schema';
import { selectFilingSnapshot } from '@/lib/financial-filing-snapshot';
import { FCFF_INPUTS } from '@/lib/quant/fcff';

/** L4: existing evidence stores and provider-ingested observations; no new scraper or provider bypass. */
export async function loadFoundation(ownerId: string, securityId: string) {
  const [companyRows, observations, prices, documents] = await Promise.all([
    db.select().from(securities).where(eq(securities.id, securityId)).limit(1),
    db.select().from(marketDataObservations).where(and(eq(marketDataObservations.securityId, securityId), eq(marketDataObservations.status, 'OK'))).orderBy(desc(marketDataObservations.retrievedAt)).limit(1000),
    db.select().from(priceHistory).where(eq(priceHistory.securityId, securityId)).orderBy(desc(priceHistory.priceDate)).limit(500),
    db.select().from(intelligenceDocuments).where(and(eq(intelligenceDocuments.ownerId, ownerId), eq(intelligenceDocuments.securityId, securityId))).orderBy(desc(intelligenceDocuments.publishedDate)).limit(25),
  ]);
  const company = companyRows[0]; if (!company) throw new Error('Security no longer exists');
  const selected = selectFilingSnapshot(observations, company.currency, [...FCFF_INPUTS, 'revenue', 'net_income', 'total_assets', 'total_equity', 'total_debt', 'cash_and_equivalents', 'shares_outstanding']);
  const facts = Object.fromEntries([...selected].map(([key, row]) => [key, Number(row.valueNumeric)]));
  const sources = [...new Set([...selected.values()].map(row => row.sourceUrl!))];
  return { company, facts, sources, fiscalDate: [...selected.values()][0]?.observationDate ?? null,
    observations: observations.map(row => ({ metric: row.metricName, value: row.valueNumeric ?? row.valueText, currency: row.currency, date: row.observationDate, source: row.sourceUrl, provider: row.provider })),
    prices: prices.reverse().map(row => ({ date: row.priceDate, close: Number(row.close), currency: row.currency })),
    documents: documents.map(row => ({ id: row.id, title: row.title, type: row.folderType, source: row.url ?? `document:${row.id}`, publishedAt: row.publishedDate?.toISOString() ?? null, excerpt: row.contentText?.slice(0, 4000) ?? '' })),
  };
}
export type Foundation = Awaited<ReturnType<typeof loadFoundation>>;
