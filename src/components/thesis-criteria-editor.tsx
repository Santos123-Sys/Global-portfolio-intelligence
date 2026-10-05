'use client';

import { ThesisPolicyEditor } from './thesis-policy-editor';
import { StrategyReviewConsole } from './strategy-review-console';
import type { ThesisCriteria } from '@portfolio-intelligence/agentic-contract';
import { assessThesisReview } from '@/lib/thesis-review';

export function ThesisCriteriaEditor({ criteria, onChange }: { criteria: ThesisCriteria; onChange: (criteria: ThesisCriteria) => void }) {
  const review = assessThesisReview(criteria);
  const requiresCorrection = review.errors.length > 0 || review.actionableIssues.length > 0;

  function update(index: number, patch: Partial<ThesisCriteria['portfolios'][number]>) {
    onChange({ ...criteria, portfolios: criteria.portfolios.map((value, position) => position === index ? { ...value, ...patch } : value) });
  }

  return <div className="setup-form strategy-editor-v3">
    <StrategyReviewConsole review={review} criteria={review.criteria} />

    <details className="strategy-editor-details" open={requiresCorrection ? true : undefined}>
      <summary>{requiresCorrection ? 'Correct structured mandate' : 'Edit structured mandate'}</summary>
      <div className="strategy-editor-form">
        {criteria.portfolios.map((portfolio, index) => <fieldset key={index} className="thesis-mandate">
          <legend>Mandate {index + 1}</legend>
          <div className="setup-form-row">
            <label>Market<select value={portfolio.role} onChange={event => update(index, { role: event.target.value })} aria-label={`Market for mandate ${index + 1}`}><option value="swiss_quality">Switzerland (SIX)</option><option value="brazilian_growth">Brazil (B3)</option>{!['swiss_quality','brazilian_growth'].includes(portfolio.role) && <option value={portfolio.role}>{portfolio.role.replaceAll('_',' ')}</option>}</select></label>
            <label>Base currency<input value={portfolio.currency} onChange={event => update(index, { currency: event.target.value.toUpperCase() })} aria-label={`Base currency for mandate ${index + 1}`} maxLength={3} placeholder="CHF" /></label>
          </div>
          <label>Investment objective<textarea value={portfolio.objective} onChange={event => update(index, { objective: event.target.value })} /></label>
          <details><summary>Investment rules and eligible companies{portfolio.policy ? ` · ${portfolio.policy.rules.length} rules` : ''}</summary><ThesisPolicyEditor policy={portfolio.policy} onChange={policy => update(index, { policy })} /></details>
          <details><summary>Additional extracted criteria</summary><div className="setup-form-row">
            <label>Inclusion criteria — one per line<textarea value={portfolio.inclusionCriteria.join('\n')} onChange={event => update(index, { inclusionCriteria: event.target.value.split('\n') })} /></label>
            <label>Exclusion criteria — one per line<textarea value={portfolio.exclusionCriteria.join('\n')} onChange={event => update(index, { exclusionCriteria: event.target.value.split('\n') })} /></label>
          </div>
          {Object.entries(portfolio.targetMetrics ?? {}).map(([key, value]) => <label key={key}>{key}<input value={value} onChange={event => update(index, { targetMetrics: { ...portfolio.targetMetrics, [key]: event.target.value } })} /></label>)}
          </details>
          {criteria.portfolios.length > 1 && <button type="button" className="secondary-button" onClick={() => onChange({ ...criteria, portfolios: criteria.portfolios.filter((_, position) => position !== index) })}>Remove mandate {index + 1}</button>}
        </fieldset>)}
        <details><summary>Portfolio-wide constraints</summary><label>One per line<textarea value={criteria.globalConstraints.join('\n')} onChange={event => onChange({ ...criteria, globalConstraints: event.target.value.split('\n') })} /></label></details>
      </div>
    </details>
  </div>;
}
