'use client';
import { useState } from 'react';
import { deriveFcff } from '@/lib/quant/fcff';
import { valuationReviewSchema, type ValuationReview } from '@/lib/valuation-review';

export function DcfAssumptionReview({ facts, currency, period, onChange }: {
  facts: Record<string, number>; currency: string; period: string | null;
  onChange: (review: ValuationReview | null) => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>({ method: 'auto' });
  const [confirmed, setConfirmed] = useState(false);
  const [interestIncluded, setInterestIncluded] = useState(false);
  function review(values: Record<string, string>, accepted: boolean, interest: boolean) {
    const number = (key: string, divisor = 1) => values[key]?.trim() ? Number(values[key]) / divisor : undefined;
    return valuationReviewSchema.safeParse({
      confirmed: accepted, financialPeriodEnd: period, currency,
      asOf: values.date, sourceUrl: values.source, rationale: values.rationale,
      fcff: { method: values.method, taxRate: number('tax', 100), workingCapitalInvestment: number('wc'), interestIncludedInCfo: interest },
      scenarios: Object.fromEntries(['worst_case', 'base_case', 'optimistic_case'].map(name => [name, {
        annualGrowthRate: number(`${name}_growth`, 100), discountRate: number(`${name}_wacc`, 100), terminalGrowthRate: number(`${name}_terminal`, 100),
      }])),
    });
  }
  function update(values: Record<string, string>, accepted = confirmed, interest = interestIncluded) {
    setFields(values); setConfirmed(accepted); setInterestIncluded(interest);
    const parsed = review(values, accepted, interest);
    onChange(parsed.success ? parsed.data : null);
  }
  const parsed = review(fields, confirmed, interestIncluded);
  const derived = deriveFcff(facts, {
    method: fields.method as 'auto' | 'ebit' | 'cfo',
    ...(fields.tax?.trim() ? { taxRate: Number(fields.tax) / 100 } : {}),
    ...(fields.wc?.trim() ? { workingCapitalInvestment: Number(fields.wc) } : {}), interestIncludedInCfo: interestIncluded,
  });
  const input = (key: string, label: string, type = 'number') => <label>{label}<input type={type} step={type === 'number' ? 'any' : undefined} value={fields[key] ?? ''} onChange={event => update({ ...fields, [key]: event.target.value })} /></label>;
  return <details className="dcf-review" open>
    <summary>Review FCFF and forecast assumptions</summary>
    <p className="note">Filing: {period ?? 'unavailable'} · {currency}. Amounts use full currency units, not millions. Forecast rates are analyst assumptions, not reported facts. All rates below are percentages.</p>
    <label>FCFF method<select value={fields.method} onChange={event => update({ ...fields, method: event.target.value })}>
      <option value="auto">Automatic supported method</option><option value="ebit">EBIT / operating profit</option><option value="cfo">Operating cash flow (CFO)</option>
    </select></label>
    <div className="dcf-review-grid">{input('tax', 'Tax rate override (%) — optional')}{input('wc', 'Non-cash working-capital investment — optional')}</div>
    <label><input type="checkbox" checked={interestIncluded} onChange={event => update(fields, confirmed, event.target.checked)} />I verified that interest expense is included in this filing’s CFO (required for CFO method).</label>
    <p>{derived.formula}</p>
    <p role="status">{derived.status === 'ready' ? `Computed FCFF: ${currency} ${derived.value?.toLocaleString()}` : `FCFF needs: ${derived.missingFields.join(', ')}`}</p>
    <details><summary>Calculation inputs and limitations</summary><dl>{Object.entries(derived.components).map(([name, value]) => <div key={name}><dt>{name.replaceAll('_', ' ')}</dt><dd>{value.toLocaleString()}</dd></div>)}</dl><ul>{derived.caveats.map(caveat => <li key={caveat}>{caveat}</li>)}</ul></details>
    <div className="dcf-review-grid">{['worst_case', 'base_case', 'optimistic_case'].map(name => <fieldset key={name}><legend>{name.replaceAll('_', ' ')}</legend>
      {input(`${name}_growth`, 'Annual FCFF growth (%)')}{input(`${name}_wacc`, 'WACC (%)')}{input(`${name}_terminal`, 'Terminal growth (%)')}
    </fieldset>)}</div>
    <p className="note">Use a WACC consistent with the currency and cash-flow risk. WACC must be greater than 0% and at most 50%, and exceed terminal growth (−5% to 5%). Annual growth supports −50% to 50%. Review the implied scenario ordering before saving.</p>
    <div className="dcf-review-grid">{input('date', 'Assumptions reviewed as of', 'date')}{input('source', 'Source / assumptions memo URL', 'url')}</div>
    <label>Rationale and sources for rates and accounting adjustments<textarea value={fields.rationale ?? ''} onChange={event => update({ ...fields, rationale: event.target.value })} /></label>
    <label><input type="checkbox" checked={confirmed} onChange={event => update(fields, event.target.checked)} />I reviewed the source, financial period, units, tax and forecast assumptions.</label>
    <p className="note" role="status">{parsed.success ? 'Review complete. The server will validate financial inputs and scenario ordering.' : 'Complete all nine scenario rates, review date, source URL, rationale (20+ characters), and confirmation.'}</p>
  </details>;
}
