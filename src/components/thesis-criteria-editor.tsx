'use client';

import { ThesisPolicyEditor } from './thesis-policy-editor';
import type { ThesisCriteria } from '@portfolio-intelligence/agentic-contract';

export function ThesisCriteriaEditor({ criteria, onChange }: { criteria: ThesisCriteria; onChange: (criteria: ThesisCriteria) => void }) {
  function update(index: number, patch: Partial<ThesisCriteria['portfolios'][number]>) {
    onChange({ ...criteria, portfolios: criteria.portfolios.map((value, position) => position === index ? { ...value, ...patch } : value) });
  }
  return <div className="setup-form">
    {criteria.portfolios.map((portfolio, index) => <fieldset key={index} className="thesis-mandate">
      <legend>Mandate {index + 1}</legend>
      <div className="setup-form-row">
        <label>Discovery destination<select value={portfolio.role} onChange={event => update(index, { role: event.target.value })} aria-label={`Portfolio destination for mandate ${index + 1}`}><option value="swiss_quality">Swiss Quality — SIX</option><option value="brazilian_growth">Brazilian Growth — B3</option>{!['swiss_quality','brazilian_growth'].includes(portfolio.role) && <option value={portfolio.role}>{portfolio.role.replaceAll('_',' ')} — research unavailable</option>}</select></label>
        <label>Reporting currency<input value={portfolio.currency} onChange={event => update(index, { currency: event.target.value })} aria-label={`Reporting currency for mandate ${index + 1}`} /></label>
      </div>
      <label>Investment objective<textarea value={portfolio.objective} onChange={event => update(index, { objective: event.target.value })} /></label>
      <ThesisPolicyEditor policy={portfolio.policy} onChange={policy => update(index, { policy })} />
      <details><summary>Source prose and legacy criteria</summary><div className="setup-form-row">
        <label>Inclusion criteria — one per line<textarea value={portfolio.inclusionCriteria.join('\n')} onChange={event => update(index, { inclusionCriteria: event.target.value.split('\n') })} /></label>
        <label>Exclusion criteria — one per line<textarea value={portfolio.exclusionCriteria.join('\n')} onChange={event => update(index, { exclusionCriteria: event.target.value.split('\n') })} /></label>
      </div>
      {Object.entries(portfolio.targetMetrics ?? {}).map(([key, value]) => <label key={key}>{key}<input value={value} onChange={event => update(index, { targetMetrics: { ...portfolio.targetMetrics, [key]: event.target.value } })} /></label>)}
      </details>
      <button type="button" className="secondary-button" disabled={criteria.portfolios.length === 1} onClick={() => onChange({ ...criteria, portfolios: criteria.portfolios.filter((_, position) => position !== index) })}>Remove mandate {index + 1}</button>
      <p className="note">Keep metric units, time periods and measurement basis explicit. Add further requirements to inclusion criteria or portfolio-wide constraints.</p>
    </fieldset>)}
    <button type="button" className="secondary-button" onClick={() => onChange({ ...criteria, portfolios: [...criteria.portfolios, { role: 'new_mandate', currency: 'Unspecified', objective: '', inclusionCriteria: [], exclusionCriteria: [] }] })}>Add mandate</button>
    <label>Portfolio-wide constraints — one per line<textarea value={criteria.globalConstraints.join('\n')} onChange={event => onChange({ ...criteria, globalConstraints: event.target.value.split('\n') })} /></label>
  </div>;
}

