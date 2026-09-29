import { NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { discoveryCandidates, valuationScenarios, brokerAccountSnapshots, brokerOrderPreviews, brokerPositionSnapshots } from '@/lib/db/workflow-schema';
import { ibkrPreviewRequestSchema, previewIbkrOrder, retrieveIbkrSnapshot } from '@/lib/ibkr-service';
import { readBoundedJson } from '@/lib/request-body';

export const runtime = 'nodejs';
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sync') }).strict(),
  z.object({ action: z.literal('preview'), order: ibkrPreviewRequestSchema }).strict(),
]);

export async function GET(request: Request) {
  const session = await authenticateRequest(request);
  if (!session.ok) return session.response;
  if (!session.auth.isPlatformAdmin) return NextResponse.json({ error: 'Broker analytics are restricted to the platform administrator' }, { status: 403 });
  return NextResponse.json(await latestSnapshot(session.auth.userId));
}

export async function POST(request: Request) {
  const session = await authenticateRequest(request);
  if (!session.ok) return session.response;
  if (!session.auth.isPlatformAdmin) return NextResponse.json({ error: 'Broker analytics are restricted to the platform administrator' }, { status: 403 });
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  const body = await readBoundedJson(request, 16 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = actionSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid IBKR request' }, { status: 400 });
  try {
    if (parsed.data.action === 'sync') {
      const snapshot = await retrieveIbkrSnapshot();
      await db.transaction(async tx => {
        const [saved] = await tx.insert(brokerAccountSnapshots).values({
          ownerId: session.auth.userId, provider: snapshot.provider, accountMasked: snapshot.account_masked,
          baseCurrency: snapshot.base_currency, cash: String(snapshot.cash), netLiquidation: String(snapshot.net_liquidation),
          availableFunds: String(snapshot.available_funds), buyingPower: String(snapshot.buying_power),
          informationGaps: snapshot.information_gaps, capturedAt: new Date(snapshot.captured_at),
        }).returning({ id: brokerAccountSnapshots.id });
        if (snapshot.positions.length) await tx.insert(brokerPositionSnapshots).values(snapshot.positions.map(position => ({
          snapshotId: saved.id, conId: String(position.con_id), symbol: position.symbol, exchange: position.exchange,
          currency: position.currency, quantity: String(position.quantity), avgCost: String(position.avg_cost),
          lastPrice: String(position.last_price), costBasis: String(position.cost_basis), marketValue: String(position.market_value),
          unrealizedPnl: String(position.unrealized_pnl), returnPct: position.return_pct,
          firstDetectedFill: position.first_detected_fill, daysSinceDetectedFill: position.days_since_detected_fill,
          annualizedReturnPct: position.annualized_return_pct,
        })));
        const retained = await tx.select({ id: brokerAccountSnapshots.id }).from(brokerAccountSnapshots)
          .where(eq(brokerAccountSnapshots.ownerId, session.auth.userId)).orderBy(desc(brokerAccountSnapshots.capturedAt)).limit(30);
        const keep = retained.map(row => row.id);
        if (keep.length === 30) {
          const all = await tx.select({ id: brokerAccountSnapshots.id }).from(brokerAccountSnapshots).where(eq(brokerAccountSnapshots.ownerId, session.auth.userId));
          const old = all.map(row => row.id).filter(id => !keep.includes(id));
          if (old.length) await tx.delete(brokerAccountSnapshots).where(inArray(brokerAccountSnapshots.id, old));
        }
      });
      return NextResponse.json(await latestSnapshot(session.auth.userId), { status: 201 });
    }
    const preview = await previewIbkrOrder(parsed.data.order);
    const latest = await db.select({ id: brokerAccountSnapshots.id }).from(brokerAccountSnapshots)
      .where(eq(brokerAccountSnapshots.ownerId, session.auth.userId)).orderBy(desc(brokerAccountSnapshots.capturedAt)).limit(1);
    await db.insert(brokerOrderPreviews).values({ ownerId: session.auth.userId, snapshotId: latest[0]?.id,
      provider: preview.provider, requestJson: parsed.data.order, resultJson: preview });
    return NextResponse.json({ preview });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'IBKR request failed' }, { status: 503 });
  }
}

const dcfSchema = z.object({ currency: z.string().length(3), scenarios: z.array(z.object({
  name: z.string(), result: z.object({ fairValuePerShare: z.number().finite().positive() }).passthrough(),
}).passthrough()) }).passthrough();

async function latestSnapshot(ownerId: string) {
  const [snapshot] = await db.select().from(brokerAccountSnapshots).where(eq(brokerAccountSnapshots.ownerId, ownerId))
    .orderBy(desc(brokerAccountSnapshots.capturedAt)).limit(1);
  if (!snapshot) return { configured: Boolean(process.env.FILINGS_API_URL && process.env.FILINGS_INTERNAL_TOKEN), snapshot: null, positions: [] };
  const [positions, valuations] = await Promise.all([
    db.select().from(brokerPositionSnapshots).where(eq(brokerPositionSnapshots.snapshotId, snapshot.id)).orderBy(desc(brokerPositionSnapshots.marketValue)),
    db.select({ ticker: discoveryCandidates.ticker, exchange: discoveryCandidates.exchange, result: valuationScenarios.resultJson, createdAt: valuationScenarios.createdAt })
      .from(valuationScenarios).innerJoin(discoveryCandidates, and(eq(valuationScenarios.candidateId, discoveryCandidates.id), eq(discoveryCandidates.ownerId, ownerId)))
      .where(eq(valuationScenarios.ownerId, ownerId)).orderBy(desc(valuationScenarios.createdAt)),
  ]);
  const bySecurity = new Map<string, { currency: string; fairValue: number; asOf: Date }>();
  const byTicker = new Map<string, { currency: string; fairValue: number; asOf: Date } | null>();
  for (const valuation of valuations) {
    const parsed = dcfSchema.safeParse(valuation.result);
    if (!parsed.success) continue;
    const base = parsed.data.scenarios.find(scenario => scenario.name === 'base_case');
    const key = `${valuation.ticker.toUpperCase()}:${valuation.exchange.toUpperCase()}`;
    if (base && !bySecurity.has(key)) {
      const item = { currency: parsed.data.currency, fairValue: base.result.fairValuePerShare, asOf: valuation.createdAt };
      bySecurity.set(key, item);
      const ticker = valuation.ticker.toUpperCase();
      if (!byTicker.has(ticker)) byTicker.set(ticker, item);
      else if (byTicker.get(ticker)?.currency !== item.currency || byTicker.get(ticker)?.fairValue !== item.fairValue) byTicker.set(ticker, null);
    }
  }
  return { configured: true, snapshot, positions: positions.map(position => {
    const valuation = bySecurity.get(`${position.symbol.toUpperCase()}:${position.exchange.toUpperCase()}`)
      ?? byTicker.get(position.symbol.toUpperCase());
    const compatible = valuation && valuation.currency === position.currency && Number(position.lastPrice) > 0 ? valuation : null;
    return { ...position, valuation: compatible ? { fairValue: compatible.fairValue,
      potentialUpside: compatible.fairValue / Number(position.lastPrice) - 1, asOf: compatible.asOf } : null };
  }) };
}
