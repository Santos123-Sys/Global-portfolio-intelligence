import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, portfolioIsOwned } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { portfolios } from '@/lib/db/schema';
import { portfolioWeightRuns as runs } from '@/lib/db/workflow-schema';
import { readBoundedJson } from '@/lib/request-body';
import { computeWeightsSchema, confirmWeightsSchema, weightResultSchema, finalWeightsSchema, validateWeightVector, decisionWarnings } from '@/lib/portfolio-weights';
import { callWeightEngine, hashSnapshot, weightUniverse } from '@/lib/portfolio-weights-service';

export const runtime = 'nodejs';
export const maxDuration = 120;
const noStore = { 'cache-control': 'private, no-store' };
const publicRun = { id: runs.id, source: runs.source, currency: runs.currency, priceHash: runs.priceHash,
  config: runs.configJson, result: runs.resultJson, final: runs.finalJson, createdAt: runs.createdAt, confirmedAt: runs.confirmedAt };

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const id = z.string().uuid().safeParse(new URL(req.url).searchParams.get('portfolioId'));
  if (!id.success || !await portfolioIsOwned(session.auth.userId, id.data)) return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 });
  const scope = and(eq(runs.ownerId, session.auth.userId), eq(runs.portfolioId, id.data));
  const snapshotId = new URL(req.url).searchParams.get('snapshot');
  if (snapshotId) {
    if (!z.string().uuid().safeParse(snapshotId).success) return NextResponse.json({ error: 'Invalid snapshot' }, { status: 400 });
    const [snapshot] = await db.select().from(runs).where(and(scope, eq(runs.id, snapshotId))).limit(1);
    if (!snapshot) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
    return NextResponse.json(snapshot, { headers: { ...noStore, 'content-disposition': `attachment; filename=portfolio-weights-${snapshot.id}.json` } });
  }
  const [history, confirmed] = await Promise.all([
    db.select(publicRun).from(runs).where(scope).orderBy(desc(runs.createdAt)).limit(5),
    db.select(publicRun).from(runs).where(and(scope, isNotNull(runs.confirmedAt))).orderBy(desc(runs.confirmedAt)).limit(1),
  ]);
  return NextResponse.json({ runs: history, current: confirmed[0] ?? null }, { headers: noStore });
}

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  const body = await readBoundedJson(req, 2_100_000);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = computeWeightsSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: 'Provide a price CSV, data source, currency and valid settings; confirm total-return data.' }, { status: 400 });
  const input = parsed.data;
  if (!await portfolioIsOwned(session.auth.userId, input.portfolioId)) return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 });
  try {
    const universe = await weightUniverse(session.auth.userId, input.portfolioId);
    if (input.currency !== universe.portfolio.baseCurrency) throw new Error('CSV currency must match the portfolio');
    const [base] = await db.select({ id: runs.id }).from(runs).where(and(eq(runs.portfolioId, input.portfolioId), isNotNull(runs.confirmedAt))).orderBy(desc(runs.confirmedAt)).limit(1);
    const result = weightResultSchema.parse(await callWeightEngine('compute', { prices_csv: input.pricesCsv, assets: universe.assets, config: input.config }));
    for (const vector of Object.values(result.weights_table)) validateWeightVector(vector, universe.assets, input.config.per_asset_max);
    validateWeightVector(result.recommendation.recommended_weights, universe.assets, input.config.per_asset_max);
    const [run] = await db.insert(runs).values({ ownerId: session.auth.userId, actorId: session.auth.actorUserId,
      portfolioId: input.portfolioId, pricesCsv: input.pricesCsv, priceHash: hashSnapshot(input.pricesCsv),
      source: input.source, currency: input.currency, holdingsHash: universe.holdingsHash, baseDecisionId: base?.id ?? null,
      configJson: input.config, resultJson: result,
    }).returning(publicRun);
    return NextResponse.json({ run }, { status: 201, headers: noStore });
  } catch (error) {
    console.error('Portfolio weight computation failed', { portfolioId: input.portfolioId, error: error instanceof Error ? error.message : 'unknown' });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Computation failed; confirmed weights unchanged' }, { status: 422 });
  }
}

export async function PUT(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  const body = await readBoundedJson(req, 16_384);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = confirmWeightsSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: 'An explicit confirmation and valid choice are required' }, { status: 400 });
  const input = parsed.data;
  const scope = and(eq(runs.id, input.runId), eq(runs.ownerId, session.auth.userId), eq(runs.portfolioId, input.portfolioId));
  const [run] = await db.select().from(runs).where(scope).limit(1);
  if (!run || !await portfolioIsOwned(session.auth.userId, input.portfolioId)) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  try {
    if (run.confirmedAt) throw new Error('This proposal was already confirmed');
    if (Date.now()-run.createdAt.getTime() > 7*86400_000) throw new Error('Proposal expired; compute a fresh recommendation');
    const warnings = decisionWarnings(run.resultJson, input.userChoice);
    if (warnings.length && !input.warningsAcknowledged) throw new Error('Review and acknowledge the displayed warnings before confirming');
    const final = finalWeightsSchema.parse(await callWeightEngine('finalize', {
      recommendation: run.resultJson.recommendation, weights_table: run.resultJson.weights_table,
      user_choice: input.userChoice, per_asset_max: run.configJson.per_asset_max,
    }));
    validateWeightVector(final.final_weights, Object.keys(run.resultJson.recommendation.recommended_weights), run.configJson.per_asset_max);
    await db.transaction(async tx => {
      // Serialize target changes per portfolio. New proposals never alter this state.
      await tx.select({ id: portfolios.id }).from(portfolios).where(eq(portfolios.id, input.portfolioId)).for('update');
      const universe = await weightUniverse(session.auth.userId, input.portfolioId);
      if (universe.holdingsHash !== run.holdingsHash || universe.portfolio.baseCurrency !== run.currency) throw new Error('Portfolio holdings changed; compute a new proposal');
      const [current] = await tx.select({ id: runs.id }).from(runs).where(and(eq(runs.portfolioId, input.portfolioId), isNotNull(runs.confirmedAt))).orderBy(desc(runs.confirmedAt)).limit(1);
      if ((current?.id ?? null) !== run.baseDecisionId) throw new Error('Confirmed target changed since this proposal; compute a new proposal');
      const updated = await tx.update(runs).set({ finalJson: final, confirmedBy: session.auth.actorUserId,
        acknowledgedWarnings: warnings, confirmedAt: new Date() }).where(and(scope, sql`${runs.confirmedAt} is null`)).returning({ id: runs.id });
      if (!updated.length) throw new Error('Proposal already confirmed');
    });
    return NextResponse.json({ final }, { headers: noStore });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Confirmation failed; target unchanged' }, { status: 409 });
  }
}
