'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { examplePortfolio } from '@/lib/example-portfolio';
import { portfolioExampleSteps, type PortfolioExampleStep, type PortfolioStage } from '@/lib/example-portfolio-walkthrough';
import type { WeightResult } from '@/lib/portfolio-weights';

interface ExampleResult extends WeightResult {
  data_kind: 'synthetic_educational_example';
  sample_starting_weights: Record<string, number>;
  asset_annualized_volatility: Record<string, number>;
}

type Portfolio = typeof examplePortfolio;
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const methodLabel: Record<string, string> = {
  '1/N': 'Equal weight', MinVar: 'Minimum variance', MaxSharpe: 'Maximum Sharpe',
  RiskParity: 'Risk parity', MaxDiv: 'Maximum diversification', Kelly_frac: 'Constrained half-Kelly',
  BlackLitterman: 'Black–Litterman, prior only', HRP: 'Hierarchical risk parity',
};

export function ExamplePortfolioExplorer({ portfolio }: { portfolio: Portfolio }) {
  const [activeStage, setActiveStage] = useState<PortfolioStage>('thesis');
  const [result, setResult] = useState<ExampleResult | null>(null);
  const [method, setMethod] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [approvalPreviewed, setApprovalPreviewed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestStarted = useRef(false);
  const requestController = useRef<AbortController | null>(null);
  const startingWeight = portfolio.assets.reduce((sum, asset) => sum + asset.startingWeight, 0);
  const selectedAsset = portfolio.assets[0]!;
  const selectedScenarios = useMemo(() => Object.fromEntries(selectedAsset.dcf.scenarios.map(item => [item.name, item.result])), [selectedAsset]);
  const chosenWeights = result?.weights_table[method];

  const loadAllocation = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/example-portfolio', { signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load the sample allocation');
      if (!signal?.aborted) {
        setResult(payload.result);
        setMethod(payload.result.recommendation.recommended_method);
      }
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : 'Sample allocation is unavailable');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !('IntersectionObserver' in window)) return;
    const steps = root.querySelectorAll<HTMLElement>('[data-example-stage]');
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const stage = (entry.target as HTMLElement).dataset.exampleStage as PortfolioStage | undefined;
          if (stage) setActiveStage(stage);
        }
      }
    }, { rootMargin: '-38% 0px -52% 0px', threshold: 0.05 });
    steps.forEach(step => observer.observe(step));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (activeStage !== 'portfolio' || !approvalPreviewed || requestStarted.current) return;
    requestStarted.current = true;
    const controller = new AbortController();
    requestController.current = controller;
    void loadAllocation(controller.signal);
  }, [activeStage, approvalPreviewed, loadAllocation]);

  useEffect(() => () => requestController.current?.abort(), []);

  const goToStage = (stage: PortfolioStage) => {
    setActiveStage(stage);
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    document.getElementById(`example-stage-${stage}`)?.scrollIntoView({ behavior, block: 'center' });
  };

  const retryAllocation = () => {
    requestStarted.current = true;
    const controller = new AbortController();
    requestController.current = controller;
    void loadAllocation(controller.signal);
  };

  const renderViewport = (step: PortfolioExampleStep, variant: 'desktop' | 'mobile') => (
    <PortfolioExampleViewport
      key={`${variant}-${step.stage}`}
      step={step}
      variant={variant}
      portfolio={portfolio}
      selectedAsset={selectedAsset}
      scenarios={selectedScenarios}
      startingWeight={startingWeight}
      result={result}
      method={method}
      weights={chosenWeights}
      loading={loading}
      error={error}
      approvalPreviewed={approvalPreviewed}
      onApprove={() => setApprovalPreviewed(true)}
      onMethodChange={setMethod}
      onRetry={retryAllocation}
      onGoToStage={goToStage}
    />
  );

  return <main className="example-portfolio example-story">
    <p className="analysis-eyebrow">Portfolio walkthrough · isolated sandbox</p>
    <h1>{portfolio.name}</h1>
    <p className="sub">Scroll through the same decision sequence the product supports: mandate, discovery, human review, analysis, valuation and portfolio controls.</p>
    <div className="card example-disclosure" role="note">
      <strong>Demonstration only: fictional companies and synthetic data.</strong>
      <p>{portfolio.researchDisclosure} Agent activity below is a simulated walkthrough, not a live run. The sample allocation uses the existing calculation engine; it cannot be saved, traded or promoted into a real portfolio.</p>
    </div>

    <PortfolioExampleProgress activeStage={activeStage} approvalPreviewed={approvalPreviewed} onSelect={goToStage} />
    <p className="sr-only" aria-live="polite">{portfolioExampleSteps.find(step => step.stage === activeStage)?.title}. {portfolioExampleSteps.find(step => step.stage === activeStage)?.uiState.status}</p>

    <div className="example-walkthrough" ref={containerRef}>
      <PortfolioExampleTimeline
        activeStage={activeStage}
        steps={portfolioExampleSteps}
        renderMobileViewport={step => renderViewport(step, 'mobile')}
        onActivate={setActiveStage}
      />
      <aside className="example-demo-sticky" aria-label="Interactive portfolio example">
        {renderViewport(portfolioExampleSteps.find(step => step.stage === activeStage) ?? portfolioExampleSteps[0]!, 'desktop')}
      </aside>
    </div>

    <PortfolioExampleFullData portfolio={portfolio} result={result} />

    <section className="card example-next-step">
      <h2>Continue with your own research</h2>
      <p>Use your thesis and verified issuer data in the live workflow. The sample research and allocation cannot be imported into a real portfolio.</p>
      <Link className="action-button inline-action" href="/investment-thesis">Start your thesis</Link>{' '}
      <Link className="text-link" href="/ai-stock-discovery">Open discovery</Link>
    </section>
  </main>;
}

function PortfolioExampleProgress({ activeStage, approvalPreviewed, onSelect }: { activeStage: PortfolioStage; approvalPreviewed: boolean; onSelect: (stage: PortfolioStage) => void }) {
  const activeIndex = portfolioExampleSteps.findIndex(step => step.stage === activeStage);
  const heldAtApproval = activeIndex > 3 && !approvalPreviewed;
  return <nav className="example-progress" aria-label="Portfolio walkthrough progress">
    <div className="example-progress-heading"><strong>Workflow</strong><span>Step {String(activeIndex + 1).padStart(2, '0')} of {String(portfolioExampleSteps.length).padStart(2, '0')}</span></div>
    <ol>
      {portfolioExampleSteps.map((step, index) => <li key={step.stage}>
        <a
          href={`#${step.id}`}
          className={[
            activeStage === step.stage ? 'is-active' : '',
            index < activeIndex && (!heldAtApproval || index < 3) ? 'is-complete' : '',
            heldAtApproval && index === 3 ? 'is-waiting' : '',
            heldAtApproval && index > 3 ? 'is-blocked' : '',
          ].filter(Boolean).join(' ')}
          aria-current={activeStage === step.stage ? 'step' : undefined}
          onClick={event => { event.preventDefault(); onSelect(step.stage); }}
        ><span className="example-progress-number">{String(index + 1).padStart(2, '0')}</span><span>{step.title}</span></a>
      </li>)}
    </ol>
  </nav>;
}

function PortfolioExampleTimeline({
  activeStage, steps, renderMobileViewport, onActivate,
}: {
  activeStage: PortfolioStage;
  steps: PortfolioExampleStep[];
  renderMobileViewport: (step: PortfolioExampleStep) => ReactNode;
  onActivate: (stage: PortfolioStage) => void;
}) {
  return <div className="example-story-column">
    {steps.map((step, index) => <PortfolioExampleStage
      key={step.stage}
      step={step}
      number={index + 1}
      active={activeStage === step.stage}
      onActivate={onActivate}
      mobileViewport={renderMobileViewport(step)}
    />)}
  </div>;
}

function PortfolioExampleStage({
  step, number, active, onActivate, mobileViewport,
}: {
  step: PortfolioExampleStep;
  number: number;
  active: boolean;
  onActivate: (stage: PortfolioStage) => void;
  mobileViewport: ReactNode;
}) {
  return <section
    id={step.id}
    className={`example-story-step${active ? ' is-active' : ''}`}
    data-example-stage={step.stage}
    data-animation={step.animation}
    aria-labelledby={`${step.id}-title`}
  >
    <div className="example-stage-copy">
      <span className="example-stage-kicker">Step {String(number).padStart(2, '0')} · {step.stage.replace('-', ' ')}</span>
      <h2 id={`${step.id}-title`}>{step.title}</h2>
      <p>{step.description}</p>
      <p className="example-stage-result"><strong>What this produces:</strong> {step.uiState.result}</p>
    </div>
    <div className="example-inline-viewport" aria-label={`${step.title} visual example`}>
      {mobileViewport}
    </div>
    <button className="example-step-activate" type="button" onClick={() => onActivate(step.stage)} aria-label={`Show ${step.title} in the walkthrough panel`}>
      Show this step in the walkthrough panel
    </button>
  </section>;
}

function PortfolioExampleViewport({
  step, variant, portfolio, selectedAsset, scenarios, startingWeight, result, method, weights,
  loading, error, approvalPreviewed, onApprove, onMethodChange, onRetry, onGoToStage,
}: {
  step: PortfolioExampleStep;
  variant: 'desktop' | 'mobile';
  portfolio: Portfolio;
  selectedAsset: Portfolio['assets'][number];
  scenarios: Record<string, Portfolio['assets'][number]['dcf']['scenarios'][number]['result']>;
  startingWeight: number;
  result: ExampleResult | null;
  method: string;
  weights: Record<string, number> | undefined;
  loading: boolean;
  error: string;
  approvalPreviewed: boolean;
  onApprove: () => void;
  onMethodChange: (method: string) => void;
  onRetry: () => void;
  onGoToStage: (stage: PortfolioStage) => void;
}) {
  return <div className={`example-viewport example-viewport-${variant}`} data-demo-stage={step.stage} role="group" aria-label={`${step.title} system preview`}>
    <div className="example-app-bar"><div className="example-app-brand"><span className="example-brand-mark" aria-hidden="true">PI</span><span><strong>Portfolio Intelligence</strong><small>Portfolio Example · demo mode</small></span></div><span className="badge">Synthetic scenario</span></div>
    <div className="example-app-content">
      <PortfolioExampleWorkflowVisualization activeStage={step.stage} approvalPreviewed={approvalPreviewed} />
      <PortfolioExampleContext step={step} portfolio={portfolio} selectedAsset={selectedAsset} />
      <PortfolioExampleAgentStatus step={step} approvalPreviewed={approvalPreviewed} />
      <div className="example-data-panel" data-animation={step.animation} key={`${variant}-${step.uiState.panel}`}>
        <ExampleStageData
          step={step}
          portfolio={portfolio}
          selectedAsset={selectedAsset}
          scenarios={scenarios}
          startingWeight={startingWeight}
          result={result}
          method={method}
          weights={weights}
          loading={loading}
          error={error}
          approvalPreviewed={approvalPreviewed}
          onApprove={onApprove}
          onMethodChange={onMethodChange}
          onRetry={onRetry}
          onGoToStage={onGoToStage}
        />
      </div>
      <p className="example-simulation-note">Simulated stage and activity · no live agent run</p>
    </div>
    <div className="example-app-footer"><span>Read-only demonstration</span><span>Nothing is saved or traded</span></div>
  </div>;
}

function PortfolioExampleWorkflowVisualization({ activeStage, approvalPreviewed }: { activeStage: PortfolioStage; approvalPreviewed: boolean }) {
  const activeIndex = portfolioExampleSteps.findIndex(step => step.stage === activeStage);
  const heldAtApproval = activeIndex > 3 && !approvalPreviewed;
  return <div className="example-mini-workflow" aria-label={`Walkthrough stage ${activeIndex + 1} of ${portfolioExampleSteps.length}`}>
    <div className="example-mini-workflow-head"><span>Example workflow</span><span>{String(activeIndex + 1).padStart(2, '0')} / {String(portfolioExampleSteps.length).padStart(2, '0')}</span></div>
    <ol>{portfolioExampleSteps.map((step, index) => <li key={step.stage} className={[
      index === activeIndex && !heldAtApproval ? 'is-current' : '',
      index < activeIndex && (!heldAtApproval || index < 3) ? 'is-complete' : '',
      heldAtApproval && index === 3 ? 'is-pending' : '',
      heldAtApproval && index > 3 ? 'is-blocked' : '',
    ].filter(Boolean).join(' ')}>
      <span className="example-mini-dot" aria-hidden="true">{index < activeIndex ? '✓' : String(index + 1)}</span>
      <span>{step.title}</span>
    </li>)}</ol>
  </div>;
}

function PortfolioExampleContext({ step, portfolio, selectedAsset }: { step: PortfolioExampleStep; portfolio: Portfolio; selectedAsset: Portfolio['assets'][number] }) {
  const currentIndex = portfolioExampleSteps.findIndex(item => item.stage === step.stage);
  const selected = currentIndex >= 2 ? `${selectedAsset.name} · ${selectedAsset.ticker}` : currentIndex === 1 ? `${portfolio.assets.length} sample records` : 'Not selected';
  return <div className="example-context-strip" role="group" aria-label="Walkthrough context">
    <span><small>Mandate</small><strong>{portfolio.name} · {portfolio.currency}</strong></span>
    <span><small>Selected example</small><strong>{selected}</strong></span>
  </div>;
}

function PortfolioExampleAgentStatus({ step, approvalPreviewed }: { step: PortfolioExampleStep; approvalPreviewed: boolean }) {
  const currentIndex = portfolioExampleSteps.findIndex(item => item.stage === step.stage);
  const status = currentIndex > 3 && !approvalPreviewed
    ? 'awaiting_approval'
    : step.stage === 'approval' && approvalPreviewed ? 'completed' : step.uiState.status;
  return <section className="example-agent-status" aria-label="Example agent activity">
    <div className="example-agent-heading"><span className="example-agent-indicator" aria-hidden="true" /><div><strong>{step.uiState.agent}</strong><small>Example activity</small></div><span className={`badge ${status === 'awaiting_approval' ? 'watch' : status === 'insufficient_data' ? 'breach' : 'ok'}`}>Demo · {status.replaceAll('_', ' ')}</span></div>
    <p>{step.uiState.action}</p>
    <small><strong>Using:</strong> {step.uiState.inputs}</small>
  </section>;
}

function ExampleStageData({
  step, portfolio, selectedAsset, scenarios, startingWeight, result, method, weights, loading, error,
  approvalPreviewed, onApprove, onMethodChange, onRetry, onGoToStage,
}: {
  step: PortfolioExampleStep;
  portfolio: Portfolio;
  selectedAsset: Portfolio['assets'][number];
  scenarios: Record<string, Portfolio['assets'][number]['dcf']['scenarios'][number]['result']>;
  startingWeight: number;
  result: ExampleResult | null;
  method: string;
  weights: Record<string, number> | undefined;
  loading: boolean;
  error: string;
  approvalPreviewed: boolean;
  onApprove: () => void;
  onMethodChange: (method: string) => void;
  onRetry: () => void;
  onGoToStage: (stage: PortfolioStage) => void;
}) {
  const company = selectedAsset;
  const approvedGate = !['analysis', 'valuation', 'portfolio', 'monitoring'].includes(step.stage) || approvalPreviewed;
  if (!approvedGate) return <div className="example-gate-panel" role="note">
    <span className="badge watch">Awaiting human review</span>
    <h3>Continue from the approval step</h3>
    <p>Analysis is shown only after you preview the user approval in this local walkthrough.</p>
    <button type="button" className="action-button" onClick={() => onGoToStage('approval')}>Review approval step</button>
  </div>;

  switch (step.stage) {
    case 'thesis': return <>
      <div className="example-panel-title"><div><span className="example-panel-eyebrow">Portfolio mandate</span><h3>{portfolio.name}</h3></div><span className="badge">Approved example thesis</span></div>
      <p>{portfolio.mandate}</p>
      <div className="example-key-value-grid"><ExampleDatum label="Market" value="Switzerland · fictional issuers" /><ExampleDatum label="Reporting currency" value={portfolio.currency} /><ExampleDatum label="Investment style" value="Quality · illustrative case" /><ExampleDatum label="Portfolio guardrail" value="Long-only · max 50% per asset" /></div>
      <p className="note">Starting weights total {pct(startingWeight)} · scenario {portfolio.scenarioVersion}.</p>
    </>;
    case 'discovery': return <>
      <div className="example-panel-title"><div><span className="example-panel-eyebrow">Sample universe</span><h3>Candidate records</h3></div><span className="badge">{portfolio.assets.length} fictional issuers</span></div>
      <div className="example-candidate-list">{portfolio.assets.map((asset, index) => <article className="example-candidate-row" key={asset.ticker} style={{ animationDelay: `${index * 55}ms` }}>
        <span className="example-candidate-number">{String(index + 1).padStart(2, '0')}</span><span className="example-candidate-copy"><strong>{asset.name}</strong><small>{asset.sector} · {asset.ticker}</small></span><span className="badge">Illustrative</span>
      </article>)}</div>
      <details><summary>Review the fit and evidence gap for every sample candidate</summary><div className="example-candidate-assessments">{portfolio.assets.map(asset => <article key={asset.ticker}><strong>{asset.name} · {asset.sector}</strong><p><b>Scenario fit:</b> {asset.thesisFit}</p><p><b>Risk to test:</b> {asset.researchRisk}</p><p><b>Evidence gap:</b> {asset.informationGap}</p></article>)}</div></details>
      <p className="note">These seeded records illustrate a results list. No real exchange, provider, or live discovery query is involved.</p>
    </>;
    case 'candidate-review': return <>
      <div className="example-panel-title"><div><span className="example-panel-eyebrow">Candidate dossier</span><h3>{company.name}</h3></div><span className="badge watch">Evidence not verified</span></div>
      <p className="example-candidate-id">{company.ticker} · {company.sector}</p>
      <div className="example-review-block"><strong>Scenario fit</strong><p>{company.thesisFit}</p></div>
      <div className="example-review-block"><strong>Risk to test</strong><p>{company.researchRisk}</p></div>
      <div className="example-review-block example-evidence-gap"><strong>Evidence gap</strong><p>{company.informationGap} No confidence score is inferred from fictional data.</p></div>
    </>;
    case 'approval': return <>
      <div className="example-panel-title"><div><span className="example-panel-eyebrow">Decision control</span><h3>Human review</h3></div><span className={`badge ${approvalPreviewed ? 'ok' : 'watch'}`}>{approvalPreviewed ? 'Previewed' : 'Awaiting user'}</span></div>
      <p>Would you send <strong>{company.name}</strong> to the next analysis stage?</p>
      <div className="example-approval-summary"><span>Thesis fit</span><span>{company.thesisFit}</span><span>Source quality</span><span>Unavailable in this fictional case</span></div>
      <button type="button" className="action-button" onClick={onApprove} aria-pressed={approvalPreviewed}>{approvalPreviewed ? 'Example approval recorded locally' : 'Preview user approval'}</button>
      <p className="note">This is a local visual state only. It does not approve an issuer in the real system.</p>
    </>;
    case 'analysis': return <>
      <div className="example-panel-title"><div><span className="example-panel-eyebrow">Financial Analyzer · illustrative inputs</span><h3>{company.name}</h3></div><span className="badge">Calculated</span></div>
      <p className="note">Invented CHF millions · no filing evidence was used.</p>
      <div className="example-metric-grid">
        <ExampleDatum label="Revenue growth" value={pct(company.revenueGrowth)} />
        <ExampleDatum label="Operating margin" value={pct(company.operatingMargin)} />
        <ExampleDatum label="Revenue" value={`CHF ${company.revenue}m`} />
        <ExampleDatum label="FCFF" value={`CHF ${company.fcff.toFixed(1)}m`} />
      </div>
      <div className="example-formula"><strong>FCFF method</strong><span>EBIT × (1 − assumed tax) + D&amp;A − CapEx − working-capital investment</span></div>
      <p className="note">In production, missing provenance, periods or required statement fields are disclosed or block dependent outputs.</p>
    </>;
    case 'valuation': return <>
      <div className="example-panel-title"><div><span className="example-panel-eyebrow">Three-case deterministic DCF</span><h3>{company.name}</h3></div><span className="badge">Illustrative CHF / share</span></div>
      <div className="example-valuation-cases">{[
        ['Downside', scenarios.worst_case], ['Base', scenarios.base_case], ['Upside', scenarios.optimistic_case],
      ].map(([label, scenario]) => {
        const value = scenario as NonNullable<typeof scenarios.base_case>;
        return <div className="example-valuation-case" key={label as string}>
          <span>{label as string}</span><strong>CHF {value.fairValuePerShare.toFixed(2)}</strong>
          <small>Growth {pct(value.assumptions.annualGrowthRate)} · discount {pct(value.assumptions.discountRate)}</small>
        </div>;
      })}</div>
      <div className="example-formula"><strong>Base case assumptions</strong><span>Terminal growth {pct(scenarios.base_case!.assumptions.terminalGrowthRate)} · net debt CHF {scenarios.base_case!.assumptions.netDebt}m · {scenarios.base_case!.assumptions.sharesOutstanding}m shares</span></div>
      <p className="example-evidence-gap"><strong>Comparable companies:</strong> unavailable—this fixture contains no peer dataset.</p>
      <details><summary>Show the five-year base-case forecast</summary><div className="table-scroll"><table><thead><tr><th>Year</th><th className="num">FCFF (CHF m)</th><th className="num">PV (CHF m)</th></tr></thead><tbody>{scenarios.base_case!.projections.map(projection => <tr key={projection.year}><td>{projection.year}</td><td className="num">{projection.freeCashFlow.toFixed(1)}</td><td className="num">{projection.presentValue.toFixed(1)}</td></tr>)}</tbody></table></div></details>
    </>;
    case 'portfolio': return <>
      <div className="example-panel-title"><div><span className="example-panel-eyebrow">Target allocation preview</span><h3>Method comparison</h3></div><span className="badge">No live portfolio changes</span></div>
      {loading && <p role="status">Loading the fixed synthetic allocation fixture…</p>}
      {error && <div role="alert"><p>{error}</p><button type="button" className="action-button" onClick={onRetry}>Retry sample calculation</button></div>}
      {result && <>
        <label htmlFor="example-allocation-method">Allocation method</label>
        <select id="example-allocation-method" aria-label="Allocation method" value={method} onChange={event => onMethodChange(event.target.value)}>
          {Object.keys(result.recommendation.ranking).map(name => <option key={name} value={name}>{methodLabel[name] ?? name}{name === result.recommendation.recommended_method ? ' · sample recommendation' : ''}</option>)}
        </select>
        <p className="note">{result.data_range.rows} synthetic trading days · cap {pct(Number(result.inputs.per_asset_max))} · {result.engine_version}</p>
        {result.recommendation.constraint_flag && <p className="caveat">{result.recommendation.constraint_flag}</p>}
        {result.recommendation.stability_flag && <p className="caveat">{result.recommendation.stability_flag}</p>}
        <div className="example-allocation-bars">{portfolio.assets.map((asset, index) => {
          const target = weights?.[asset.ticker] ?? 0;
          return <div className="example-allocation-row" key={asset.ticker} style={{ animationDelay: `${index * 45}ms` }}>
            <div className="example-allocation-label"><span>{asset.name}</span><strong>{pct(target)}</strong></div>
            <div className="example-allocation-track" role="meter" aria-label={`${asset.name} preview weight`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number((target * 100).toFixed(1))}><span style={{ width: `${Math.min(100, target * 100)}%` }} /></div>
          </div>;
        })}</div>
        <details><summary>Compare starting weights, targets and synthetic volatility</summary><div className="table-scroll"><table><thead><tr><th>Fictional company</th><th className="num">Starting</th><th className="num">Target</th><th className="num">Change</th><th className="num">Synthetic volatility</th></tr></thead><tbody>{portfolio.assets.map(asset => { const target = weights?.[asset.ticker]; return <tr key={asset.ticker}><td>{asset.name}</td><td className="num">{pct(asset.startingWeight)}</td><td className="num">{target === undefined ? '—' : pct(target)}</td><td className="num">{target === undefined ? '—' : `${((target - asset.startingWeight) * 100).toFixed(1)} pp`}</td><td className="num">{pct(result.asset_annualized_volatility[asset.ticker] ?? 0)}</td></tr>; })}</tbody></table></div></details>
        <p className="note">Starting portfolio: {pct(startingWeight)} total. A method selection changes this preview only; a person decides what to do next.</p>
      </>}
    </>;
    case 'monitoring': {
      const metrics = result?.recommendation.ranking[method];
      return <>
        <div className="example-panel-title"><div><span className="example-panel-eyebrow">Historical synthetic snapshot</span><h3>Portfolio controls</h3></div><span className="badge watch">Not live monitoring</span></div>
        {metrics ? <div className="example-metric-grid">
          <ExampleDatum label="Annualized volatility" value={pct(metrics.vol)} />
          <ExampleDatum label="Maximum drawdown" value={pct(metrics.max_drawdown)} />
          <ExampleDatum label="Sharpe ratio" value={metrics.sharpe.toFixed(2)} />
          <ExampleDatum label="Eligibility" value={metrics.eligible ? 'Within sample limits' : 'Limit breached'} />
        </div> : <p className="note">The fixed sample risk metrics appear after the allocation preview is loaded.</p>}
        <div className="example-monitor-event"><span className="example-event-dot" /><div><strong>Research update</strong><p>This synthetic case has no news, filings, or refreshed evidence feed.</p></div></div>
        <div className="example-monitor-event"><span className="example-event-dot muted" /><div><strong>Investment control</strong><p>Production controls require a user review and do not trade automatically.</p></div></div>
      </>;
    }
  }
}

function ExampleDatum({ label, value }: { label: string; value: string }) {
  return <div className="example-datum"><span>{label}</span><strong>{value}</strong></div>;
}

function PortfolioExampleFullData({ portfolio, result }: { portfolio: Portfolio; result: ExampleResult | null }) {
  return <details className="example-full-data">
    <summary>Open the complete example data and calculation tables</summary>
    <p className="note">Expanded detail is provided for review; every value below is fictional and synthetic, consistent with the walkthrough.</p>
    <h2>Illustrative financial inputs</h2>
    <div className="table-scroll"><table><thead><tr><th>Company</th><th className="num">Prior revenue</th><th className="num">Revenue</th><th className="num">Growth</th><th className="num">EBIT</th><th className="num">Margin</th><th className="num">D&amp;A</th><th className="num">CapEx</th><th className="num">Working capital</th><th className="num">FCFF</th></tr></thead><tbody>{portfolio.assets.map(asset => <tr key={asset.ticker}><td>{asset.name}</td><td className="num">{asset.revenuePrior}</td><td className="num">{asset.revenue}</td><td className="num">{pct(asset.revenueGrowth)}</td><td className="num">{asset.ebit}</td><td className="num">{pct(asset.operatingMargin)}</td><td className="num">{asset.depreciation}</td><td className="num">{asset.capex}</td><td className="num">{asset.workingCapital}</td><td className="num">{asset.fcff.toFixed(1)}</td></tr>)}</tbody></table></div>
    <h2>Three-case DCF · illustrative CHF per share</h2>
    <div className="table-scroll"><table><thead><tr><th>Company</th><th className="num">Growth</th><th className="num">Discount rate</th><th className="num">Terminal growth</th><th className="num">Downside</th><th className="num">Base</th><th className="num">Upside</th><th className="num">Base enterprise value</th></tr></thead><tbody>{portfolio.assets.map(asset => { const cases = Object.fromEntries(asset.dcf.scenarios.map(item => [item.name, item.result])); const base = cases.base_case!; return <tr key={asset.ticker}><td>{asset.name}</td><td className="num">{pct(base.assumptions.annualGrowthRate)}</td><td className="num">{pct(base.assumptions.discountRate)}</td><td className="num">{pct(base.assumptions.terminalGrowthRate)}</td><td className="num">CHF {cases.worst_case!.fairValuePerShare.toFixed(2)}</td><td className="num">CHF {base.fairValuePerShare.toFixed(2)}</td><td className="num">CHF {cases.optimistic_case!.fairValuePerShare.toFixed(2)}</td><td className="num">CHF {base.enterpriseValue.toFixed(1)}m</td></tr>; })}</tbody></table></div>
    <details><summary>Inspect DCF assumptions and annual base-case forecasts</summary>{portfolio.assets.map(asset => <section className="example-full-forecast" key={asset.ticker}><h3>{asset.name}</h3><div className="table-scroll"><table><thead><tr><th>Case</th><th className="num">Growth</th><th className="num">Discount</th><th className="num">Terminal growth</th><th className="num">Net debt</th><th className="num">Shares (m)</th></tr></thead><tbody>{asset.dcf.scenarios.map(scenario => <tr key={scenario.name}><td>{scenario.label}</td><td className="num">{pct(scenario.result.assumptions.annualGrowthRate)}</td><td className="num">{pct(scenario.result.assumptions.discountRate)}</td><td className="num">{pct(scenario.result.assumptions.terminalGrowthRate)}</td><td className="num">{scenario.result.assumptions.netDebt}</td><td className="num">{scenario.result.assumptions.sharesOutstanding}</td></tr>)}</tbody></table></div><h4>Base case forecast (CHF millions)</h4><div className="table-scroll"><table><thead><tr><th>Year</th><th className="num">FCFF</th><th className="num">Discount factor</th><th className="num">Present value</th></tr></thead><tbody>{asset.dcf.scenarios.find(item => item.name === 'base_case')!.result.projections.map(row => <tr key={row.year}><td>{row.year}</td><td className="num">{row.freeCashFlow.toFixed(1)}</td><td className="num">{row.discountFactor.toFixed(3)}</td><td className="num">{row.presentValue.toFixed(1)}</td></tr>)}</tbody></table></div></section>)}</details>
    <h2>Allocation methodology</h2>
    <p className="note">The allocation fixture is generated by the existing eight-method engine from a seeded synthetic price series; method ranking and selected target weights are available after opening this walkthrough to the allocation step.</p>
    {result && <><p className="note">Synthetic observations: {result.data_range.rows} trading days ({result.data_range.start}–{result.data_range.end}) · cap {pct(Number(result.inputs.per_asset_max))} · engine {result.engine_version}</p><div className="table-scroll"><table><thead><tr><th>Method</th><th className="num">Sharpe</th><th className="num">CAGR</th><th className="num">Volatility</th><th className="num">Max drawdown</th><th className="num">Bootstrap sensitivity</th><th>Limit</th></tr></thead><tbody>{Object.entries(result.recommendation.ranking).map(([name, row]) => <tr key={name}><td>{methodLabel[name] ?? name}{name === '1/N' ? ' · benchmark' : ''}</td><td className="num">{row.sharpe.toFixed(2)}</td><td className="num">{pct(row.cagr)}</td><td className="num">{pct(row.vol)}</td><td className="num">{pct(row.max_drawdown)}</td><td className="num">{pct(row.mad_from_base)}</td><td>{row.eligible ? 'Pass' : 'Breach'}</td></tr>)}</tbody></table></div></>}
  </details>;
}
