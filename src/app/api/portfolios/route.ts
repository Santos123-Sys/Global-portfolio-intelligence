import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { portfolios, positions, thesisVersions } from '@/lib/db/schema';
import { and, count, desc, eq, sql, sum } from 'drizzle-orm';
import { fetchEcbRates, displayTotal } from '@/lib/fx';
import { Currency } from '@/lib/quant/types';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { portfolioCreateSchema } from '@/lib/portfolio-setup';
import { readBoundedJson } from '@/lib/request-body';
import { activeThesisPortfolioRoles, operationalPortfolioIds } from '@/lib/operational-portfolios';

export const runtime = 'nodejs';

/**
 * Returns each portfolio with its NATIVE-currency total, plus an optional
 * display-only converted grand total when ?displayCurrency= is supplied.
 *
 * The two are deliberately separate keys in the response. A client that ignores
 * `displayTotal` still gets correct, unblended figures.
 */
export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const url = new URL(req.url);
  const displayCurrency = url.searchParams.get('displayCurrency') as Currency | null;

  const [rows, thesisRows] = await Promise.all([
    db.select({
        id: portfolios.id,
        name: portfolios.name,
        portfolioType: portfolios.portfolioType,
        baseCurrency: portfolios.baseCurrency,
        investmentObjective: portfolios.investmentObjective,
        totalValueNative: sum(positions.marketValueNative),
        holdingCount: count(positions.id),
      })
      .from(portfolios)
      .leftJoin(positions, eq(positions.portfolioId, portfolios.id))
      .where(eq(portfolios.ownerId, session.auth.userId))
      .groupBy(portfolios.id),
    db.select({ criteriaJson: thesisVersions.criteriaJson, excludedAt: thesisVersions.excludedAt, supersededAt: thesisVersions.supersededAt })
      .from(thesisVersions).where(eq(thesisVersions.ownerId, session.auth.userId)).orderBy(desc(thesisVersions.versionNumber)),
  ]);

  const activeRoles = activeThesisPortfolioRoles(thesisRows);
  const visibleIds = operationalPortfolioIds(rows, new Set(rows.filter(row => Number(row.holdingCount) > 0).map(row => row.id)), activeRoles);

  const items = rows.filter(row => visibleIds.has(row.id)).map((r) => ({
    ...r,
    holdingCount: Number(r.holdingCount),
    totalValueNative: Number(r.totalValueNative ?? 0),
  }));

  if (!displayCurrency) {
    return NextResponse.json({ portfolios: items, displayTotal: null });
  }

  try {
    const { rateDate, perEur } = await fetchEcbRates();
    const total = displayTotal(
      items.map((p) => ({
        portfolioId: p.id,
        name: p.name,
        valueNative: p.totalValueNative,
        currency: p.baseCurrency as Currency,
      })),
      displayCurrency,
      perEur,
      rateDate
    );
    return NextResponse.json({ portfolios: items, displayTotal: total });
  } catch (e) {
    // FX failure must never block native figures.
    return NextResponse.json({
      portfolios: items,
      displayTotal: null,
      displayTotalError: (e as Error).message,
    });
  }
}

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 });
  }

  const body = await readBoundedJson(req, 16 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = portfolioCreateSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [duplicate] = await db
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(and(
      eq(portfolios.ownerId, session.auth.userId),
      sql`lower(${portfolios.name}) = lower(${parsed.data.name})`
    ))
    .limit(1);
  if (duplicate) {
    return NextResponse.json({ error: 'A portfolio with this name already exists' }, { status: 409 });
  }

  try {
    const [portfolio] = await db.insert(portfolios).values({
      ownerId: session.auth.userId,
      name: parsed.data.name,
      portfolioType: parsed.data.portfolioType,
      baseCurrency: parsed.data.baseCurrency,
      investmentObjective: parsed.data.investmentObjective,
    }).returning();
    return NextResponse.json({ portfolio }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Unable to create portfolio' }, { status: 500 });
  }
}
