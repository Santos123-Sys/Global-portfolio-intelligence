'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { examplePortfolio } from '@/lib/example-portfolio';
import type { WeightResult } from '@/lib/portfolio-weights';

interface ExampleResult extends WeightResult {
  data_kind: 'synthetic_educational_example';
  sample_starting_weights: Record<string, number>;
  asset_annualized_volatility: Record<string, number>;
}

type Portfolio = typeof examplePortfolio;
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const methodLabel: Record<string, string> = { '1/N': 'Equal weight', MinVar: 'Minimum variance', MaxSharpe: 'Maximum Sharpe',
  RiskParity: 'Risk parity', MaxDiv: 'Maximum diversification', Kelly_frac: 'Constrained half-Kelly',
  BlackLitterman: 'Black–Litterman, prior only', HRP: 'Hierarchical risk parity' };

export function ExamplePortfolioExplorer({ portfolio }: { portfolio: Portfolio }) {
  const [result, setResult] = useState<ExampleResult | null>(null);
  const [method, setMethod] = useState<string>('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  async function load(signal?: AbortSignal) {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/example-portfolio', { signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to compute the sample allocation');
      if (!signal?.aborted) {
        setResult(payload.result);
        setMethod(payload.result.recommendation.recommended_method);
      }
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : 'Computation failed');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, []);
  const weights = result?.weights_table[method];
  const starting = portfolio.assets.reduce((sum, asset) => sum + asset.startingWeight, 0);

  return <main className="example-portfolio">
    <p className="analysis-eyebrow">Interactive example · isolated sandbox</p>
    <h1>{portfolio.name}</h1>
    <p className="sub">Follow a populated example from mandate through research and financial analysis to a computed target allocation.</p>
    <div className="card example-disclosure" role="note"><strong>Educational example: fictional companies and synthetic prices.</strong><p>{portfolio.researchDisclosure} The allocation uses the same calculation engine as the live planner, but cannot be saved, traded or converted into a live portfolio.</p></div>
    <nav className="example-steps" aria-label="Example workflow"><a href="#example-mandate">01 · Portfolio</a><a href="#example-research">02 · Research</a><a href="#example-analysis">03 · Analysis</a><a href="#example-allocation">04 · Allocation</a></nav>

    <section id="example-mandate" className="card"><h2>01 · Predefined portfolio</h2><p>{portfolio.mandate}</p><p className="note">Starting weights total {pct(starting)} · CHF reporting currency · {portfolio.scenarioVersion} scenario.</p>
      <div className="table-scroll"><table><thead><tr><th>Fictional company</th><th>Illustrative identifier</th><th>Sector</th><th className="num">Starting weight</th></tr></thead><tbody>
        {portfolio.assets.map(asset => <tr key={asset.ticker}><td>{asset.name}</td><td>{asset.ticker}</td><td>{asset.sector}</td><td className="num">{pct(asset.startingWeight)}</td></tr>)}
      </tbody></table></div>
    </section>

    <section id="example-research" className="card"><h2>02 · Sample research review</h2><p className="note">These are example thesis observations and risks. They were written for the scenario and carry no external evidence or approval status.</p>
      <div className="example-cards">{portfolio.assets.map(asset => <article className="card" key={asset.ticker}>
        <h3>{asset.name}</h3><p className="note">{asset.sector} · {asset.researchStatus.replace('_', ' ')}</p>
        <p><strong>Scenario fit:</strong> {asset.thesisFit}</p><p><strong>Risk to test:</strong> {asset.researchRisk}</p><p className="note"><strong>Evidence gap:</strong> {asset.informationGap}</p>
      </article>)}</div>
    </section>

    <section id="example-analysis" className="card"><h2>03 · Financial analysis</h2><p className="note">All figures below are invented CHF millions. Revenue growth and margin are computed from the displayed inputs. The existing deterministic FCFF function computes EBIT × (1 − 22% assumed tax) + depreciation − capex − working-capital investment. No DCF fair value is claimed.</p>
      <div className="table-scroll"><table><thead><tr><th>Company</th><th className="num">Prior revenue</th><th className="num">Revenue</th><th className="num">Growth</th><th className="num">EBIT</th><th className="num">Margin</th><th className="num">D&A</th><th className="num">Capex</th><th className="num">Working capital</th><th className="num">FCFF</th></tr></thead><tbody>
        {portfolio.assets.map(asset => <tr key={asset.ticker}><td>{asset.name}</td><td className="num">{asset.revenuePrior}</td><td className="num">{asset.revenue}</td><td className="num">{pct(asset.revenueGrowth)}</td><td className="num">{asset.ebit}</td><td className="num">{pct(asset.operatingMargin)}</td><td className="num">{asset.depreciation}</td><td className="num">{asset.capex}</td><td className="num">{asset.workingCapital}</td><td className="num">{asset.fcff.toFixed(1)}</td></tr>)}
      </tbody></table></div><p className="note">No filing or market evidence was used. In the live workflow, missing source documents would block a source-grounded valuation.</p>
    </section>

    <section id="example-allocation" className="card"><h2>04 · Compute portfolio weights</h2><p className="note">The private allocation service runs the actual eight-method engine on a fixed, seeded synthetic price series. The starting portfolio is a comparison, not a live holding.</p>
      {loading && <p role="status">Computing the sample allocation…</p>}
      {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => void load()}>Retry calculation</button></div>}
      {result && <>
        <p className="note">Synthetic observations: {result.data_range.rows} trading days ({result.data_range.start}–{result.data_range.end}); cap {pct(Number(result.inputs.per_asset_max))}; engine {result.engine_version}. No real market or issuer data was used.</p>
        <label htmlFor="example-method">Explore allocation method</label><select id="example-method" value={method} onChange={event => setMethod(event.target.value)}>
          {Object.keys(result.recommendation.ranking).map(name => <option key={name} value={name}>{methodLabel[name] ?? name}{name === result.recommendation.recommended_method ? ' · sample recommendation' : ''}</option>)}
        </select>
        {result.recommendation.constraint_flag && <p role="alert">{result.recommendation.constraint_flag}</p>}
        {result.recommendation.stability_flag && <p role="alert">{result.recommendation.stability_flag}</p>}
        <div className="table-scroll"><table><thead><tr><th>Fictional company</th><th className="num">Starting</th><th className="num">Sample target</th><th className="num">Difference</th><th className="num">Synthetic annualized volatility</th></tr></thead><tbody>
          {portfolio.assets.map(asset => { const target = weights?.[asset.ticker]; return <tr key={asset.ticker}><td>{asset.name}</td><td className="num">{pct(asset.startingWeight)}</td><td className="num">{target === undefined ? '—' : pct(target)}</td><td className="num">{target === undefined ? '—' : `${((target - asset.startingWeight) * 100).toFixed(1)} pp`}</td><td className="num">{pct(result.asset_annualized_volatility[asset.ticker])}</td></tr>; })}
        </tbody></table></div>
        <h3>Method comparison · synthetic out-of-sample history</h3>
        <div className="table-scroll"><table><thead><tr><th>Method</th><th className="num">Sharpe</th><th className="num">CAGR</th><th className="num">Volatility</th><th className="num">Maximum drawdown</th><th className="num">Bootstrap sensitivity</th><th>Limit</th></tr></thead><tbody>
          {Object.entries(result.recommendation.ranking).map(([name, row]) => <tr key={name}><td>{methodLabel[name] ?? name}{name === '1/N' ? ' · benchmark' : ''}</td><td className="num">{row.sharpe.toFixed(2)}</td><td className="num">{pct(row.cagr)}</td><td className="num">{pct(row.vol)}</td><td className="num">{pct(row.max_drawdown)}</td><td className="num">{pct(row.mad_from_base)}</td><td>{row.eligible ? 'Pass' : 'Breach'}</td></tr>)}
        </tbody></table></div><p className="note">The recommendation ranks historical methods; it is not a forward forecast. Selecting a method here changes this preview only.</p>
      </>}
    </section>
    <section className="card"><h2>Ready for real research?</h2><p>Use your own thesis and verified issuer data in the live workflow. Sample research and weights cannot be promoted into it.</p><Link className="action-button inline-action" href="/investment-thesis">Start your thesis</Link> <Link className="text-link" href="/ai-stock-discovery">Open discovery</Link></section>
  </main>;
}
