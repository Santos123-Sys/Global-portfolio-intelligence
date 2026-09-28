import type { MarketAnalysis, MarketPlan } from '@portfolio-intelligence/agentic-contract';

export function MarketAnalysisReview({ plan, analysis }: { plan: MarketPlan; analysis?: MarketAnalysis | null }) {
  const context = plan.context;
  return <section className="research-framework" aria-label="Market-specific analysis">
    <h4>Market-specific analysis</h4>
    <p>{plan.profiles.map(p => `${p.id} · v${p.version}`).join(' + ') || 'Market needs review'}{plan.hybrid ? ' · Combined jurisdiction and exposure review' : ''}</p>
    <div className="dcf-review-grid">
      <p><strong>Incorporation:</strong> {context.incorporationCountry ?? 'Needs evidence'}</p>
      <p><strong>Listings:</strong> {context.listingExchanges.join(', ')}</p>
      <p><strong>Reporting currency:</strong> {context.reportingCurrency ?? 'Needs evidence'}</p>
      <p><strong>Accounting:</strong> {context.accountingStandard ?? 'Needs evidence'}</p>
      <p><strong>Revenue geography:</strong> {context.revenueGeography.map(r => `${r.country} ${(r.share * 100).toFixed(1)}%`).join(', ') || 'Needs evidence'}</p>
      <p><strong>Regulation:</strong> {context.regulatoryJurisdictions.join(', ') || 'Needs evidence'}</p>
    </div>
    {plan.issues.length > 0 && <details><summary>What valuation still needs ({plan.issues.length})</summary><ul>{plan.issues.map(i => <li key={i.code}>{i.detail}</li>)}</ul></details>}
    <details><summary>Research modules and conventions</summary>
      {plan.profiles.map(p => <div key={p.id}><strong>{p.id}</strong><p>{p.riskFreePolicy}</p><p>{p.taxPolicy}</p><p>{p.peerPolicy}</p></div>)}
      <ol>{plan.nodes.map(n => { const execution = analysis?.executions.find(e => e.agent === n.id); return <li key={n.id}>
        <strong>{n.id.replace(/Agent$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')}</strong>{execution && ` — ${execution.status.replaceAll('_', ' ')}`}
        <p>{execution?.detail || n.reason}</p>
        {execution?.finding?.claims.map((c, i) => <p key={i}>{c.statement}<small className="note"> Evidence: {c.evidenceRefs.join(', ')}</small></p>)}
        {execution?.finding?.risks.map((r, i) => <p className="caveat" key={i}>{r.statement} — {r.scenario.replaceAll('_', ' ')}: {r.assumption.replaceAll('_', ' ')} ({r.direction}).</p>)}
      </li>; })}</ol>
    </details>
    {analysis?.conflicts.map(i => <p key={i.code} className="caveat">{i.detail}</p>)}
  </section>;
}
