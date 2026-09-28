'use client';

/**
 * Allocation (Page 2) — Section 5.3. Weight breakdown by sector, country and
 * asset class, for exactly one portfolio at a time (ADR-002: no blending
 * across currencies, and grouping two portfolios together would do exactly
 * that for any portfolio pair in different native currencies).
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { PortfolioSelector, type SelectablePortfolio } from '@/components/portfolio-selector';
import { PortfolioWorkspaceNav } from '@/components/portfolio-workspace-nav';
import { usePortfolioBreadcrumb } from '@/lib/portfolio-context';
import { portfolioExposure } from '@/lib/portfolio-exposure';
import { PortfolioWeightPlanner } from '@/components/portfolio-weight-planner';

interface PositionRow {
  id: string;
  ticker: string;
  companyName: string;
  sector: string | null;
  country: string | null;
  portfolioId: string;
  currency: string;
  marketValueNative: string | number | null;
  weight: number | null;
  lastPricedAt: string | null;
}

interface GroupRow {
  key: string;
  label: string;
  weight: number;
}

const COLORS = ['#4a9eff', '#d9a441', '#6fcf97', '#bb86fc', '#e05c5c', '#56b8d1', '#8b949e'];

function groupBy(rows: Array<PositionRow & { effectiveWeight: number }>, keyFn: (r: PositionRow) => string | null): GroupRow[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const key = keyFn(r)?.trim() || 'Unclassified';
    totals.set(key, (totals.get(key) ?? 0) + r.effectiveWeight);
  }
  return [...totals.entries()]
    .map(([key, weight]) => ({ key, label: key, weight }))
    .sort((a, b) => b.weight - a.weight);
}

function DonutSection({ title, groups }: { title: string; groups: GroupRow[] }) {
  return (
    <div className="chart-card">
      <h2>{title}</h2>
      {groups.length === 0 ? (
        <p className="note">No positions to allocate.</p>
      ) : (
        <>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={groups} dataKey="weight" nameKey="label" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {groups.map((g, i) => (
                    <Cell key={g.key} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [
                    `${(Number(value ?? 0) * 100).toFixed(1)}%`,
                    String(name ?? ''),
                  ]}
                  contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', fontSize: '0.8rem' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <table>
            <thead>
              <tr>
                <th>{title}</th>
                <th className="num">Weight</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key}>
                  <td>{g.label}</td>
                  <td className="num">{(g.weight * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export default function AllocationPage() {
  const { setViewing } = usePortfolioBreadcrumb();
  const [portfolios, setPortfolios] = useState<SelectablePortfolio[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/portfolios');
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const data: { portfolios: SelectablePortfolio[] } = await res.json();
        if (cancelled) return;
        setPortfolios(data.portfolios);
        if (data.portfolios.length > 0) setSelectedId((cur) => cur ?? data.portfolios[0].id);
        else setLoading(false);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const p = portfolios.find((x) => x.id === selectedId);
    if (p) setViewing({ id: p.id, name: p.name, currency: p.baseCurrency });
  }, [selectedId, portfolios, setViewing]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoading(true);
    setPositions([]);
    setError(null);
    fetch(`/api/positions?portfolioId=${selectedId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        return res.json();
      })
      .then((data: { positions: PositionRow[] }) => {
        if (!cancelled) setPositions(data.positions);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selectedPortfolio = portfolios.find((p) => p.id === selectedId) ?? null;
  const exposure = useMemo(() => portfolioExposure(positions, selectedPortfolio?.baseCurrency ?? ''), [positions, selectedPortfolio?.baseCurrency]);
  const sectorGroups = useMemo(() => groupBy(exposure.rows, (r) => r.sector), [exposure.rows]);
  const countryGroups = useMemo(() => groupBy(exposure.rows, (r) => r.country), [exposure.rows]);
  const currencyGroups = useMemo(() => groupBy(exposure.rows, (r) => r.currency), [exposure.rows]);
  const largest = [...exposure.rows].sort((a, b) => b.effectiveWeight - a.effectiveWeight);
  const priced = positions.filter((r) => r.lastPricedAt).length;

  if (error) {
    return (
      <main>
        <PortfolioWorkspaceNav />
        <h1>Allocation</h1>
        <div className="card">
          <p className="note">
            Connection failed: Unable to reach backend.
            <br />
            Check that the API is running and DATABASE_URL is set.
            <br />
            {error}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <PortfolioWorkspaceNav />
      <h1>Allocation</h1>
      <p className="sub">See the holdings, exposures and concentration of one portfolio at a time.</p>
      <p><Link className="text-link" href="/example-portfolio">Explore a populated example portfolio</Link></p>

      <PortfolioSelector portfolios={portfolios} selectedId={selectedId} onSelect={setSelectedId} />

      {loading ? (
        <p className="note">Fetching...</p>
      ) : !selectedPortfolio ? (
        <div className="card"><h2>Create a portfolio to begin</h2><Link className="action-button inline-action" href="/portfolio-setup">Set up portfolio</Link></div>
      ) : positions.length === 0 ? (
        <div className="card">
          <h2>No holdings in {selectedPortfolio.name} yet</h2>
          <p className="note">Add a holding to see its sector, country, currency and concentration here.</p>
          <Link className="action-button inline-action" href="/portfolio-setup">Add a holding</Link>
        </div>
      ) : (
        <>
        <section className="allocation-summary" aria-label="Allocation coverage">
          <div className="card"><span className="note">Holdings</span><strong>{positions.length}</strong></div>
          <div className="card"><span className="note">Weight source</span><strong>{exposure.source ?? 'Unavailable'}</strong></div>
          <div className="card"><span className="note">Dated prices</span><strong>{priced}/{positions.length}</strong></div>
        </section>
        {exposure.reason ? <div className="card" role="status"><h2>Allocation needs data</h2><p className="note">{exposure.reason}</p><Link className="action-button inline-action" href="/positions">Review positions</Link></div> : <>
        <p className="note">Weights describe recorded holdings only. Country is the security classification, not underlying revenue exposure. Fund look-through is not recorded. Confirmed targets are shown separately below.</p>
        <div className="grid">
          <DonutSection title="Sector" groups={sectorGroups} />
          <DonutSection title="Country" groups={countryGroups} />
          <DonutSection title="Currency" groups={currencyGroups} />
        </div>
        <section className="card allocation-holdings"><h2>Largest holdings</h2><p className="note">Top {Math.min(5, largest.length)} account for {(largest.slice(0, 5).reduce((sum, row) => sum + row.effectiveWeight, 0) * 100).toFixed(1)}% of recorded holdings.</p>
          <div className="table-scroll"><table><thead><tr><th>Holding</th><th>Sector</th><th>Country</th><th className="num">Weight</th></tr></thead><tbody>{largest.slice(0, 5).map((row) => <tr key={row.id}><td>{row.companyName} <span className="note">{row.ticker}</span></td><td>{row.sector || 'Unclassified'}</td><td>{row.country || 'Unclassified'}</td><td className="num">{(row.effectiveWeight * 100).toFixed(1)}%</td></tr>)}</tbody></table></div>
        </section>
        </>}
        </>
      )}
      {selectedPortfolio && !loading && <PortfolioWeightPlanner key={selectedPortfolio.id} portfolioId={selectedPortfolio.id} currency={selectedPortfolio.baseCurrency} holdings={exposure.rows.length ? exposure.rows : positions} />}
    </main>
  );
}
