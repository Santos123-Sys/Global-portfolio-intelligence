'use client';

import { useEffect, useState } from 'react';
import { decisionWarnings, type WeightConfig, type WeightResult, type FinalWeights } from '@/lib/portfolio-weights';

type Run = { id: string; source: string; currency: string; priceHash: string; config: WeightConfig;
  result: WeightResult; final: FinalWeights | null; createdAt: string; confirmedAt: string | null };
type Holding = { ticker: string; effectiveWeight?: number };
const defaults: WeightConfig = { objective: 'balanced', rf: 0.02, max_drawdown: null,
  est_window: 756, step: 126, cost: 0.001, n_boot: 60, seed: 0, per_asset_max: 0.60 };
const pct = (n: number) => `${(n*100).toFixed(2)}%`;
const labels: Record<string, string> = { '1/N': 'Equal weight', MinVar: 'Minimum variance', MaxSharpe: 'Maximum Sharpe',
  RiskParity: 'Risk parity (capped)', MaxDiv: 'Maximum diversification', Kelly_frac: 'Constrained half-Kelly',
  BlackLitterman: 'Black–Litterman (prior only)', HRP: 'Hierarchical risk parity (capped)' };

export function PortfolioWeightPlanner({ portfolioId, currency, holdings }: {
  portfolioId: string; currency: string; holdings: Holding[];
}) {
  const [config, setConfig] = useState<WeightConfig>(defaults);
  const [csv, setCsv] = useState('');
  const [source, setSource] = useState('');
  const [attested, setAttested] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const [current, setCurrent] = useState<Run | null>(null);
  const [mode, setMode] = useState('recommendation');
  const [method, setMethod] = useState('1/N');
  const [custom, setCustom] = useState<Record<string, number>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/portfolio/weights?portfolioId=${portfolioId}`, { signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load allocation history'); return data; })
      .then(data => { setRuns(data.runs); setCurrent(data.current); setSelected(data.runs[0] ?? null); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [portfolioId]);

  const recommendation = selected?.result.recommendation;
  const customTotal = Object.values(custom).reduce((a, b) => a+b, 0);
  const choice = mode === 'custom' ? custom : mode === 'method' ? method : 'recommendation';
  const warnings = selected ? decisionWarnings(selected.result, choice) : [];
  const preview = mode === 'custom' ? Object.fromEntries(Object.entries(custom).map(([key, value]) => [key, customTotal > 0 ? value/customTotal : 0]))
    : mode === 'method' ? selected?.result.weights_table[method] : recommendation?.recommended_weights;
  const validCustom = mode !== 'custom' || (customTotal > 0 && Object.values(custom).every(v => Number.isFinite(v) && v >= 0)
    && Object.keys(recommendation?.recommended_weights ?? {}).every(asset => Object.hasOwn(custom, asset))
    && Object.values(preview ?? {}).every(v => v <= (selected?.config.per_asset_max ?? 1)+1e-7));
  const resetDecision = () => { setAcknowledged(false); setMode('recommendation'); setMethod('1/N'); setCustom({}); setMessage(''); };

  async function compute() {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/portfolio/weights', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ portfolioId, currency, pricesCsv: csv, source, totalReturnConfirmed: attested, config }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to compute weights');
      setSelected(data.run); setRuns(previous => [data.run, ...previous].slice(0, 5)); resetDecision();
      setMessage('Recommendation saved. Your confirmed allocation is unchanged.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!selected) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/portfolio/weights', { method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ portfolioId, runId: selected.id, userChoice: choice, confirm: true, warningsAcknowledged: acknowledged }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to confirm target');
      const saved = { ...selected, final: data.final, confirmedAt: new Date().toISOString() };
      setCurrent(saved); setSelected(saved); setRuns(previous => previous.map(r => r.id === saved.id ? saved : r));
      setMessage('Target allocation confirmed and audited. No trades were placed.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="card weight-planner" aria-label="Portfolio weight planner">
    <h2>Plan your target allocation</h2>
    <p className="note">Compare eight methods using historical out-of-sample results and input sensitivity. Review the proposal, choose weights, then confirm. Recorded holdings change only when you record trades.</p>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <h3>Confirmed target</h3>
    {current?.final ? <><p className="note">Confirmed {new Date(current.confirmedAt!).toLocaleString()} · {current.final.source}</p>
      <div className="table-scroll"><table><thead><tr><th>Asset</th><th>Recorded weight</th><th>Target</th><th>Difference</th></tr></thead><tbody>
        {Array.from(new Set([...holdings.map(h => h.ticker), ...Object.keys(current.final.final_weights)])).map(asset => {
          const actual = holdings.find(h => h.ticker === asset)?.effectiveWeight;
          const target = current.final!.final_weights[asset];
          return <tr key={asset}><td>{asset}</td><td>{actual === undefined ? 'Unavailable' : pct(actual)}</td><td>{target === undefined ? 'Not in target' : pct(target)}</td><td>{actual === undefined || target === undefined ? '—' : `${((actual-target)*100).toFixed(2)} pp`}</td></tr>;
        })}
      </tbody></table></div></> : <p className="note">No target confirmed yet.</p>}
    <details open={!selected}><summary>Data and computation settings</summary>
      <p className="note">Upload daily dividend-adjusted total-return prices in {currency}. First column: date (YYYY-MM-DD); remaining columns: {holdings.map(h => h.ticker).join(', ')}. Supply at least {config.est_window+config.step+1} rows, ending within ten days. Maximum: 3,000 rows, 12 assets and 2 MB. Missing values are rejected.</p>
      <label>Price CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={async e => {
        const file = e.target.files?.[0]; setCsv(''); setAttested(false);
        if (file && file.size > 2_000_000) { setError('CSV must be at most 2 MB'); return; }
        if (file) setCsv(await file.text());
      }} /></label>
      <label>Data provider / source reference<input value={source} maxLength={300} onChange={e => setSource(e.target.value)} placeholder="Provider, export date or source URL" /></label>
      <label><input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} /> I confirm these are real daily total-return prices in {currency}, not synthetic data or unadjusted closes.</label>
      <div className="weight-settings">
        <label>Objective<select value={config.objective} onChange={e => setConfig({ ...config, objective: e.target.value as WeightConfig['objective'] })}>
          <option value="balanced">Balanced</option><option value="max_sharpe">Maximum Sharpe</option><option value="min_vol">Minimum volatility</option><option value="max_growth">Maximum growth</option>
        </select></label>
        {([['rf', 'Risk-free rate (decimal)', -0.1, 0.5, 0.001], ['per_asset_max', 'Asset cap (decimal)', 0.01, 1, 0.01],
          ['est_window', 'Estimation days', 60, 1260, 1], ['step', 'Rebalance days', 21, 252, 1],
          ['cost', 'One-way cost (decimal)', 0, 0.02, 0.0001], ['n_boot', 'Bootstrap samples', 10, 100, 1], ['seed', 'Reproducibility seed', 0, 2147483647, 1]] as const).map(([key, label, min, max, step]) =>
          <label key={key}>{label}<input type="number" min={min} max={max} step={step} value={config[key]} onChange={e => setConfig({ ...config, [key]: e.target.valueAsNumber })} /></label>)}
        <label>Historical drawdown limit (decimal, optional)<input type="number" min={0.01} max={1} step={0.01} value={config.max_drawdown ?? ''} onChange={e => setConfig({ ...config, max_drawdown: e.target.value === '' ? null : e.target.valueAsNumber })} /></label>
      </div>
      <p className="note">Balanced and Maximum Sharpe share the supplied scoring rule. Caps can change risk-parity and HRP allocations. Black–Litterman uses an equal-weight equilibrium prior without investor views; half-Kelly uses a fully-invested, long-only quadratic growth approximation. Historical drawdown is not a future loss guarantee. The optimizer cap is separate from the portfolio monitoring guardrails.</p>
    </details>
    <button className="action-button" disabled={busy || !csv || source.trim().length < 3 || !attested || holdings.length < 2} onClick={compute}>{busy ? 'Processing…' : 'Compute recommendation'}</button>
    {runs.length > 0 && <label>Saved proposals<select disabled={busy} value={selected?.id ?? ''} onChange={e => { setSelected(runs.find(r => r.id === e.target.value) ?? null); resetDecision(); }}>
      <option value="" disabled>Select a proposal</option>{runs.map(r => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleString()} · {r.result.recommendation.recommended_method}{r.final ? ' · confirmed' : ''}</option>)}
    </select></label>}
    {selected && recommendation && <>
      <h3>Recommendation: {labels[recommendation.recommended_method]}</h3>
      <p className="note">Source: {selected.source} · {selected.currency} · {selected.result.data_range.start}–{selected.result.data_range.end} · cap {pct(selected.config.per_asset_max)}. This is a proposal requiring your decision.</p>
      <div className="table-scroll"><table><thead><tr><th>Proposed asset</th><th>Weight</th></tr></thead><tbody>{Object.entries(recommendation.recommended_weights).map(([asset, weight]) => <tr key={asset}><td>{asset}</td><td>{pct(weight)}</td></tr>)}</tbody></table></div>
      {[recommendation.stability_flag, recommendation.constraint_flag].filter(Boolean).map(w => <p role="alert" key={w}>{w}</p>)}
      <h3>All methods · out-of-sample, net of modeled costs</h3>
      <div className="table-scroll"><table><thead><tr><th>Method</th><th>Score</th><th>CAGR</th><th>Volatility</th><th>Sharpe</th><th>Drawdown</th><th>Annual turnover</th><th>Instability</th><th>Drawdown limit</th></tr></thead><tbody>
        {Object.entries(recommendation.ranking).map(([name, row]) => <tr key={name}><td>{labels[name]}{name === recommendation.recommended_method ? ' · recommended' : ''}{name === '1/N' ? ' · benchmark' : ''}</td><td>{row.score.toFixed(3)}</td><td>{pct(row.cagr)}</td><td>{pct(row.vol)}</td><td>{row.sharpe.toFixed(2)}</td><td>{pct(row.max_drawdown)}</td><td>{pct(row.ann_turnover)}</td><td>{pct(row.mad_from_base)}</td><td>{row.eligible ? 'Pass' : 'Breach'}</td></tr>)}
      </tbody></table></div>
      <p className="note">Scores combine the objective metric, bootstrap sensitivity and a turnover penalty. These methods were ranked on the displayed history; this is not an independent test of the winning method. Bootstrap samples do not model market regimes, taxes or liquidity.</p>
      {!selected.final && <fieldset disabled={busy}><legend>Your allocation decision</legend>
        <label>Decision<select value={mode} onChange={e => { setMode(e.target.value); setAcknowledged(false); }}><option value="recommendation">Accept recommendation</option><option value="method">Choose another method</option><option value="custom">Enter custom weights</option></select></label>
        {mode === 'method' && <label>Method<select value={method} onChange={e => { setMethod(e.target.value); setAcknowledged(false); }}>{Object.keys(recommendation.ranking).map(m => <option key={m} value={m}>{labels[m]}</option>)}</select></label>}
        {mode === 'custom' && <><div className="weight-settings">{Object.keys(recommendation.recommended_weights).map(asset => <label key={asset}>{asset} (relative weight)<input type="number" min={0} step={0.1} value={custom[asset] ?? ''} onChange={e => { setCustom({ ...custom, [asset]: e.target.valueAsNumber }); setAcknowledged(false); }} /></label>)}</div><p className="note">Custom values are normalized to 100%. Every asset needs a non-negative value and the resulting weights must meet the cap.</p></>}
        <h4>Weights to confirm</h4><div className="table-scroll"><table><thead><tr><th>Asset</th><th>Target weight</th></tr></thead><tbody>{Object.entries(preview ?? {}).map(([asset, weight]) => <tr key={asset}><td>{asset}</td><td>{Number.isFinite(weight) ? pct(weight) : 'Enter valid value'}</td></tr>)}</tbody></table></div>
        {warnings.length > 0 && <div role="alert">{warnings.map(w => <p key={w}>{w}</p>)}<label><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} /> I reviewed these warnings and choose to proceed.</label></div>}
        <div className="weight-actions"><button className="action-button" disabled={!validCustom || (warnings.length > 0 && !acknowledged)} onClick={confirm}>Confirm target allocation</button><button onClick={() => { setSelected(null); setMessage('Decision deferred. Previous confirmed weights retained.'); }}>Defer decision</button></div>
      </fieldset>}
      <details><summary>Audit and reproducibility</summary><p className="note">Engine {selected.result.engine_version} · price snapshot SHA-256: {selected.priceHash}. The complete price CSV, settings, dependency versions, result and human confirmation are stored with this proposal. Proposals expire after seven days.</p><a href={`/api/portfolio/weights?portfolioId=${portfolioId}&snapshot=${selected.id}`}>Download audit snapshot</a></details>
    </>}
  </section>;
}
