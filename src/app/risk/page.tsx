'use client';

/**
 * Risk Detail (Page 6) — Section 5.3. Every persisted metric for one
 * portfolio, each individually drillable into its full methodology
 * (ADR-003), plus the global caveat about VaR and parametric assumptions that
 * must stay visible regardless of which metric is expanded.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PortfolioSelector, type SelectablePortfolio } from '@/components/portfolio-selector';
import { PortfolioWorkspaceNav } from '@/components/portfolio-workspace-nav';
import { MetricDrill, type DrillableMetric } from '@/components/metric-drill';
import { usePortfolioBreadcrumb } from '@/lib/portfolio-context';

function GlobalCaveat() {
  return (
    <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: '2rem' }}>
      <p className="caveat" style={{ marginTop: 0 }}>
        Parametric VaR may rely on a return distribution and correlations that do not hold in stress.
        Historical VaR is limited by its lookback period. Neither method guarantees a maximum loss,
        especially for concentrated or illiquid holdings.
      </p>
    </div>
  );
}

export default function RiskDetailPage() {
  const { setViewing } = usePortfolioBreadcrumb();
  const [portfolios, setPortfolios] = useState<SelectablePortfolio[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<DrillableMetric[]>([]);
  const [holdingCount, setHoldingCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/portfolios')
      .then((res) => {
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        return res.json();
      })
      .then((data: { portfolios: SelectablePortfolio[] }) => {
        if (cancelled) return;
        setPortfolios(data.portfolios);
        if (data.portfolios.length > 0) setSelectedId((cur) => cur ?? data.portfolios[0].id);
        else setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
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
    setMetrics([]); setHoldingCount(null); setError(null);
    Promise.all([
      fetch(`/api/risk?portfolioId=${encodeURIComponent(selectedId)}`),
      fetch(`/api/positions?portfolioId=${encodeURIComponent(selectedId)}`),
    ]).then(async ([risk, positions]) => {
      if (!risk.ok || !positions.ok) throw new Error(`Risk evidence could not be loaded (${risk.status}/${positions.status})`);
      return Promise.all([risk.json() as Promise<{ metrics: DrillableMetric[] }>, positions.json() as Promise<{ positions: unknown[] }>]);
    })
      .then(([risk, positions]) => {
        if (!cancelled) { setMetrics(risk.metrics); setHoldingCount(positions.positions.length); }
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

  if (error) {
    return (
      <main>
        <PortfolioWorkspaceNav />
        <h1>Portfolio risk</h1>
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
      <h1>Portfolio risk</h1>
      <p className="sub">Portfolio-level risk for recorded holdings. Candidate risk is reviewed inside the discovery workflow before a holding is added.</p>

      <GlobalCaveat />

      <PortfolioSelector portfolios={portfolios} selectedId={selectedId} onSelect={setSelectedId} />

      {loading ? (
        <p className="note">Fetching...</p>
      ) : !selectedId ? (
        <div className="card"><h2>Create a portfolio to begin</h2><Link className="action-button inline-action" href="/portfolio-setup">Set up portfolio</Link></div>
      ) : metrics.length === 0 ? (
        <div className="card">
          <h2>{holdingCount === 0 ? 'Add a holding to assess risk' : 'Waiting for risk history'}</h2>
          <p className="note">{holdingCount === 0 ? 'This portfolio has no recorded holdings. Add one first; risk estimates need sufficient market-price history.' : `${holdingCount ?? 0} holdings are recorded, but no risk estimates have been computed yet. Metrics appear after a price refresh has sufficient history.`}</p>
          <Link className="action-button inline-action" href={holdingCount === 0 ? '/portfolio-setup' : '/positions'}>{holdingCount === 0 ? 'Add a holding' : 'Review positions'}</Link>
        </div>
      ) : (
        <>
        <p className="note">{holdingCount} recorded holdings · {metrics.length} computed measures. Each measure has its own as-of date, method and caveats; open it to inspect the evidence.</p>
        <div className="grid">
          {metrics.map((m) => (
            <div className="card" key={m.metricName}>
              <MetricDrill metric={m} />
            </div>
          ))}
        </div>
        </>
      )}
    </main>
  );
}
