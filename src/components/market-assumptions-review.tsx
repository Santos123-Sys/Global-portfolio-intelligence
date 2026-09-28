'use client';
import { useState } from 'react';
import { MarketValuationReview, computeCostOfCapital, validateMarketValuation, type MarketContext, type MarketProfile, marketProfiles } from '@portfolio-intelligence/agentic-contract';

type Fields = Record<string, string>;
export function MarketAssumptionsReview({ initial, currency, profiles, onChange }: { initial: MarketContext; currency: string; profiles?: MarketProfile[];
  onChange: (value: MarketValuationReview | null, wacc?: number) => void }) {
  const [fields, setFields] = useState<Fields>({ incorporation: initial.incorporationCountry ?? '', reporting: initial.reportingCurrency ?? '',
    accounting: initial.accountingStandard ?? '', regulatory: initial.regulatoryJurisdictions.join(', '), basis: 'nominal' });
  const [geography, setGeography] = useState(initial.revenueGeography.map(r => ({ country: r.country, percent: String(r.share * 100) })));
  function evaluate(f: Fields, rows = geography) {
    const datum = (key: string, divisor = 100) => ({ value: f[key]?.trim() ? Number(f[key]) / divisor : NaN, asOf: f.date, sourceRef: f.source });
    const parsed = MarketValuationReview.safeParse({
      profileSnapshot: profiles ?? marketProfiles,
      context: { ...initial, incorporationCountry: f.incorporation || null, reportingCurrency: f.reporting || null, accountingStandard: f.accounting || null,
        regulatoryJurisdictions: (f.regulatory ?? '').split(',').map(s => s.trim()).filter(Boolean),
        revenueGeography: rows.map(r => ({ country: r.country, share: Number(r.percent) / 100 })),
        sourceReferences: { ...initial.sourceReferences, ...Object.fromEntries(['incorporationCountry', 'reportingCurrency', 'accountingStandard', 'regulatoryJurisdictions', 'revenueGeography'].map(k => [k, f.source])) } },
      capital: { currency, cashFlowBasis: 'nominal', riskFreeBasis: f.basis, riskFreeRate: datum('rf'),
        expectedInflation: f.basis === 'real' ? datum('inflation') : null, matureErp: datum('erp'), countryRiskPremium: datum('crp'),
        beta: datum('beta', 1), taxRate: datum('tax'), preTaxCostOfDebt: datum('kd'), equityWeight: datum('equity'),
        debtIncludesCountryRisk: true, additionalDebtSpread: null },
    });
    if (!parsed.success || !/^https?:\/\/[^\s/]+/.test(f.source ?? '')) return { value: null, errors: ['Complete all market dimensions, source/date and cost-of-capital inputs. Use ISO country codes (BR, US, CH).'] };
    const errors = validateMarketValuation(parsed.data, currency, new Date(), profiles).filter(i => i.severity === 'BLOCK').map(i => i.detail);
    try { const computed = computeCostOfCapital(parsed.data.capital); return { value: errors.length ? null : parsed.data, computed, errors }; }
    catch (error) { return { value: null, errors: [...errors, (error as Error).message] }; }
  }
  function update(f: Fields, rows = geography) { setFields(f); setGeography(rows); const r = evaluate(f, rows); onChange(r.value, r.computed?.wacc); }
  const result = evaluate(fields);
  const input = (key: string, label: string, type = 'number') => <label>{label}<input type={type} step={type === 'number' ? 'any' : undefined} value={fields[key] ?? ''} onChange={e => update({ ...fields, [key]: e.target.value })} /></label>;
  return <details open className="dcf-review"><summary>Market context and cost of capital</summary>
    <p className="note">Verify these dimensions from filings and a dated assumptions memo. Rates are percentages; beta is a ratio. No market rate or tax default is inserted. The memo must identify the source and date of each input.</p>
    <div className="dcf-review-grid">{input('incorporation', 'Incorporation country code', 'text')}{input('reporting', 'Company reporting currency', 'text')}
      <label>Accounting standard<select aria-label="Accounting standard" value={fields.accounting} onChange={e => update({ ...fields, accounting: e.target.value })}><option value="">Select verified standard</option>{['IFRS', 'US_GAAP', 'SWISS_GAAP_FER', 'OTHER'].map(v => <option key={v}>{v}</option>)}</select></label>
      {input('regulatory', 'Regulatory jurisdictions (country codes, comma separated)', 'text')}
    </div>
    <fieldset><legend>Revenue geography — total 100%</legend>{geography.map((row, i) => <div className="dcf-review-grid" key={i}>
      <label>Country code<input value={row.country} maxLength={2} onChange={e => update(fields, geography.map((r, ix) => ix === i ? { ...r, country: e.target.value.toUpperCase() } : r))} /></label>
      <label>Revenue share (%)<input type="number" min="0" max="100" step="any" value={row.percent} onChange={e => update(fields, geography.map((r, ix) => ix === i ? { ...r, percent: e.target.value } : r))} /></label>
      <button type="button" className="secondary-button" onClick={() => update(fields, geography.filter((_, ix) => ix !== i))}>Remove geography</button>
    </div>)}<button type="button" className="secondary-button" onClick={() => update(fields, [...geography, { country: '', percent: '' }])}>Add revenue geography</button></fieldset>
    <div className="dcf-review-grid">{input('rf', 'Default-free rate (%)')}
      <label>Risk-free rate basis<select aria-label="Risk-free rate basis" value={fields.basis} onChange={e => update({ ...fields, basis: e.target.value })}><option value="nominal">Nominal</option><option value="real">Real — requires inflation conversion</option></select></label>
      {fields.basis === 'real' && input('inflation', 'Expected inflation (%)')}{input('erp', 'Mature-market equity risk premium (%)')}
      {input('crp', 'Company-exposure country risk premium (%) — explicit zero allowed with evidence')}{input('beta', 'Levered beta')}
      {input('tax', 'Marginal tax rate (%)')}{input('kd', 'Marginal debt yield including sovereign risk (%)')}{input('equity', 'Market-value equity weight (%)')}
      {input('date', 'Inputs as of', 'date')}{input('source', 'Filings / assumptions memo URL', 'url')}
    </div>
    <p className="note">Debt weight is 100% minus equity weight. The stated debt yield must already include sovereign risk. A real risk-free rate is converted using (1 + real rate) × (1 + expected inflation) − 1. This workbench uses nominal cash flows in {currency}.</p>
    {result.computed && <p><strong>Computed base WACC: {(result.computed.wacc * 100).toFixed(4)}%</strong> · Cost of equity {(result.computed.costOfEquity * 100).toFixed(4)}%</p>}
    <ul aria-live="polite">{result.errors.map(e => <li key={e} className="caveat">{e}</li>)}</ul>
  </details>;
}
