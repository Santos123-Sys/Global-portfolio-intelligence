'use client';
import {
  emptyThesisPolicy,
  type ThesisPolicy,
  type ThesisRule,
} from '@portfolio-intelligence/agentic-contract';

const geography = [
  ['listingMarkets', 'Listing markets (MICs, e.g. BVMF or XSWX)'],
  ['domicileCountries', 'Company domicile (ISO codes, e.g. BR or CH)'],
  ['operatingCountries', 'Operating geography (ISO codes)'],
  ['revenueCountries', 'Revenue exposure (ISO codes)'],
  ['securityTypes', 'Security types (provider labels)'],
  ['sectorsIncluded', 'Required sectors'],
  ['sectorsExcluded', 'Excluded sectors'],
  ['industriesIncluded', 'Required industries'],
  ['industriesExcluded', 'Excluded industries'],
] as const;

export function ThesisPolicyEditor({
  policy,
  onChange,
}: {
  policy?: ThesisPolicy;
  onChange: (p: ThesisPolicy) => void;
}) {
  if (!policy)
    return (
      <div>
        <p className="note">
          These extracted criteria remain prose. Add a structured policy to
          control eligibility and distinguish preferences from context.
        </p>
        <button
          className="secondary-button"
          type="button"
          onClick={() => onChange(emptyThesisPolicy())}
        >
          Structure this mandate
        </button>
      </div>
    );
  const updateRule = (index: number, patch: Partial<ThesisRule>) =>
    onChange({
      ...policy,
      rules: policy.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    });
  return (
    <div className="setup-form">
      <details open>
        <summary>Mandate and portfolio rules</summary>
        <div className="setup-form-row">
          {(
            [
              ['name', 'Portfolio name'],
              ['strategy', 'Strategy'],
              ['benchmark', 'Benchmark (optional)'],
              ['horizon', 'Investment horizon'],
            ] as const
          ).map(([field, label]) => (
            <label key={field}>
              {label}
              <input
                value={policy[field] ?? ''}
                onChange={(e) =>
                  onChange({ ...policy, [field]: e.target.value || undefined })
                }
              />
            </label>
          ))}
          {(
            [
              ['targetHoldings', 'Target holdings'],
              ['maximumHoldings', 'Maximum holdings'],
            ] as const
          ).map(([field, label]) => (
            <label key={field}>
              {label}
              <input
                type="number"
                min="1"
                max="1000"
                step="1"
                value={policy[field] ?? ''}
                onChange={(e) =>
                  onChange({
                    ...policy,
                    [field]:
                      e.target.value === ''
                        ? undefined
                        : Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
        </div>
        <p className="note">
          Holdings describe the portfolio mandate; the Discovery shortlist limit
          is a separate research setting.
        </p>
      </details>
      <details open>
        <summary>Eligible universe</summary>
        <p className="note">
          Each populated field is a hard restriction. Alternatives within a
          field use OR; separate fields use AND. Leave a field empty for no
          restriction. Reporting currency never determines geography.
          Operating/revenue fields require explicit provider evidence; narrative
          summaries cannot certify exposure.
        </p>
        <div className="setup-form-row">
          {geography.slice(0, 2).map(([field, label]) => (
            <label key={field}>
              {label}
              <textarea
                rows={2}
                value={policy.universe[field].join('\n')}
                onChange={(e) =>
                  onChange({
                    ...policy,
                    universe: {
                      ...policy.universe,
                      [field]: e.target.value.split('\n'),
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
        <details><summary>Operating / revenue exposure, security types and sector restrictions</summary>
        <div className="setup-form-row">
          {geography.slice(2).map(([field, label]) => (
            <label key={field}>
              {label}
              <textarea
                rows={2}
                value={policy.universe[field].join('\n')}
                onChange={(e) =>
                  onChange({
                    ...policy,
                    universe: {
                      ...policy.universe,
                      [field]: e.target.value.split('\n'),
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
        </details>
        <p className="note">
          One value per line. Current automated markets: B3 (BVMF) and SIX
          (XSWX). Provider labels for sectors and security types must match
          exactly, ignoring case.
        </p>
      </details>
      <details open>
        <summary>Selection, macro, risk and valuation rules</summary>
        <p className="note">
          Hard = eligibility requirement. Preference = ranking consideration.
          Context = analysis assumption. No numeric threshold is inferred.
        </p>
        {policy.rules.map((r, index) => (
          <fieldset key={index} className="thesis-mandate">
            <legend>Rule {index + 1}</legend>
            <label>
              Statement
              <textarea
                value={r.statement}
                onChange={(e) =>
                  updateRule(index, { statement: e.target.value })
                }
              />
            </label>
            <div className="setup-form-row">
              <label>
                Effect
                <select
                  value={r.kind}
                  onChange={(e) =>
                    updateRule(index, {
                      kind: e.target.value as ThesisRule['kind'],
                    })
                  }
                >
                  <option value="hard">Hard constraint</option>
                  <option value="preference">Preference</option>
                  <option value="context">Contextual assumption</option>
                </select>
              </label>
              <label>
                Category
                <select
                  value={r.category}
                  onChange={(e) =>
                    updateRule(index, {
                      category: e.target.value as ThesisRule['category'],
                    })
                  }
                >
                  {['selection', 'macro', 'sector', 'risk', 'valuation'].map(
                    (v) => (
                      <option key={v}>{v}</option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <details>
              <summary>Measurable predicate (optional)</summary>
              <p className="note">
                Use only an investor-approved threshold. Provider metric, unit
                and period must all match; missing data cannot pass a hard rule.
                Examples: market capitalization in BRL at a stated date, average
                daily traded value over 90 days, ROIC in percent for FY2025.
              </p>
              {r.metric ? (
                <>
                  <div className="setup-form-row">
                    {(['field', 'unit', 'period'] as const).map((field) => (
                      <label key={field}>
                        {field === 'field'
                          ? 'Provider metric key'
                          : field === 'unit'
                            ? 'Unit or currency'
                            : 'Measurement period'}
                        <input
                          value={r.metric![field]}
                          onChange={(e) =>
                            updateRule(index, {
                              metric: { ...r.metric!, [field]: e.target.value },
                            })
                          }
                        />
                      </label>
                    ))}
                    <label>
                      Comparison
                      <select
                        value={r.metric.operator}
                        onChange={(e) =>
                          updateRule(index, {
                            metric: {
                              ...r.metric!,
                              operator: e.target.value as 'gte' | 'lte',
                            },
                          })
                        }
                      >
                        <option value="gte">At least</option>
                        <option value="lte">At most</option>
                      </select>
                    </label>
                    <label>
                      Threshold
                      <input
                        type="number"
                        step="any"
                        value={
                          Number.isFinite(r.metric.value) ? r.metric.value : ''
                        }
                        onChange={(e) =>
                          updateRule(index, {
                            metric: {
                              ...r.metric!,
                              value:
                                e.target.value === ''
                                  ? NaN
                                  : Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => updateRule(index, { metric: undefined })}
                  >
                    Remove predicate
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    updateRule(index, {
                      metric: {
                        field: '',
                        unit: '',
                        period: '',
                        operator: 'gte',
                        value: NaN,
                      },
                    })
                  }
                >
                  Add explicit metric
                </button>
              )}
            </details>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                onChange({
                  ...policy,
                  rules: policy.rules.filter((_, i) => i !== index),
                })
              }
            >
              Remove rule {index + 1}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            onChange({
              ...policy,
              rules: [
                ...policy.rules,
                { statement: '', kind: 'preference', category: 'selection' },
              ],
            })
          }
        >
          Add classified rule
        </button>
      </details>
    </div>
  );
}
