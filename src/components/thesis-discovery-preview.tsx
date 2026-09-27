import {
  thesisDiscoveryPlan,
  type ThesisCriteria,
} from '@portfolio-intelligence/agentic-contract';
export function ThesisDiscoveryPreview({
  criteria,
}: {
  criteria: ThesisCriteria;
}) {
  return (
    <div className="thesis-summary">
      <h3>What Discovery will search for</h3>
      {thesisDiscoveryPlan(criteria).map((p, i) => (
        <article className="thesis-mandate" key={`${p.role}-${i}`}>
          <h4>
            {p.name} · {p.reportingCurrency}
          </h4>
          <p>{p.objective}</p>
          {(p.strategy || p.horizon || p.benchmark) && <p>Strategy: {p.strategy || 'not specified'} · Horizon: {p.horizon || 'not specified'} · Benchmark: {p.benchmark || 'none'}</p>}
          {(p.targetHoldings || p.maximumHoldings) && <p>Holdings: target {p.targetHoldings ?? 'not specified'}, maximum {p.maximumHoldings ?? 'not specified'}</p>}
          <p>
            <strong>Search coverage:</strong>{' '}
            {p.searchMarkets.join(', ') || 'No automated market configured'}.
            Current coverage is limited to native-currency listings in these
            markets. Reporting currency does not establish company geography.
          </p>
          {p.universe && (
            <dl>
              {Object.entries(p.universe)
                .filter(([, values]) => values.length)
                .map(([field, values]) => (
                  <div key={field}>
                    <dt>{field.replace(/([A-Z])/g, ' $1')}</dt>
                    <dd>{values.join(', ')}</dd>
                  </div>
                ))}
            </dl>
          )}
          {(
            [
              ['Hard constraints', p.hardConstraints],
              ['Preferences', p.preferences],
              ['Macro / sector / other context', p.contextualAssumptions],
            ] as const
          ).map(([title, rules]) => (
            <div key={title}>
              <strong>{title}</strong>
              {rules.length ? (
                <ul>
                  {rules.map((r, index) => (
                    <li key={index}>
                      {r.statement}{' '}
                      {r.metric &&
                        `(${r.metric.field} ${r.metric.operator === 'gte' ? '≥' : '≤'} ${r.metric.value} ${r.metric.unit}, ${r.metric.period})`}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="note">None specified.</p>
              )}
            </div>
          ))}
          {p.legacyPreferences.length > 0 && (
            <p>
              <strong>Unclassified prose for review:</strong>{' '}
              {p.legacyPreferences.join(' · ')}
            </p>
          )}
          {p.exclusions.length > 0 && (
            <p>
              <strong>Prose exclusions:</strong> {p.exclusions.join(' · ')}
            </p>
          )}
          {p.globalConstraints.length > 0 && (
            <p>
              <strong>Portfolio-wide constraints:</strong>{' '}
              {p.globalConstraints.join(' · ')}
            </p>
          )}
          <p className="note">
            {p.evidencePolicy} Qualitative prose still requires evidence-based
            human review.
          </p>
        </article>
      ))}
    </div>
  );
}
