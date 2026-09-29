import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { portfolios, positions, securities } from '@/lib/db/schema';
import { requirePageSession } from '@/lib/page-auth';

export const dynamic = 'force-dynamic';

export default async function PortfolioPage() {
  const session = await requirePageSession();
  const rows = await db
    .select({
      id: positions.id,
      portfolioId: positions.portfolioId,
      portfolioName: portfolios.name,
      portfolioCurrency: portfolios.baseCurrency,
      ticker: securities.ticker,
      companyName: securities.companyName,
      country: securities.country,
      sector: securities.sector,
      quantity: positions.quantity,
      avgCost: positions.avgCost,
      marketValue: positions.marketValueNative,
      weight: positions.weight,
      pricedAt: positions.lastPricedAt,
    })
    .from(positions)
    .innerJoin(portfolios, eq(positions.portfolioId, portfolios.id))
    .innerJoin(securities, eq(positions.securityId, securities.id))
    .where(eq(portfolios.ownerId, session.userId))
    .orderBy(desc(positions.weight));

  return (
    <main>
      <section className="dashboard-hero animate-fade-in">
        <h1 className="text-glow">Portfolio</h1>
        <p className="hero-lead">Holdings, allocation and position-level state. Values remain in each portfolio&apos;s native currency.</p>
        <div className="dashboard-hero-actions" aria-label="Portfolio summary">
          <div className="stat-chip animate-scale-in delay-100"><span>Portfolios</span><span className="stat-value">{new Set(rows.map((row) => row.portfolioId)).size}</span></div>
          <div className="stat-chip animate-scale-in delay-200"><span>Holdings</span><span className="stat-value">{rows.length}</span></div>
          <div className="stat-chip animate-scale-in delay-300"><span>Priced</span><span className="stat-value">{rows.filter((row) => row.pricedAt != null).length}</span></div>
        </div>
      </section>
      <div className="card glow-card table-scroll">
      <table>
        <thead><tr><th>Portfolio</th><th>Security</th><th>Country</th><th>Sector</th><th className="num">Quantity</th><th className="num">Avg Cost</th><th className="num">Market Value</th><th className="num">Weight</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            <td>{r.portfolioName}<br /><span className="note">{r.portfolioCurrency}</span></td>
            <td><strong>{r.companyName}</strong><br /><span className="note">{r.ticker}</span></td>
            <td>{r.country ?? '—'}</td>
            <td>{r.sector ?? '—'}</td>
            <td className="num">{Number(r.quantity).toLocaleString()}</td>
            <td className="num">{Number(r.avgCost).toFixed(2)}</td>
            <td className="num">{r.marketValue == null ? '—' : Number(r.marketValue).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
            <td className="num">{r.weight == null ? '—' : `${(r.weight * 100).toFixed(2)}%`}</td>
          </tr>
        ))}</tbody>
      </table>
      </div>
      {rows.length === 0 && <div className="card glow-card"><p className="note">No positions stored.</p></div>}
    </main>
  );
}
