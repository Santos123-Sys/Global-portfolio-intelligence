import {
  thesisDiscoveryPlan,
  type ThesisCriteria,
} from '@portfolio-intelligence/agentic-contract';

const clusterLabels = {
  mandate: '1. Mandate & allocation context',
  universe: '2. Deterministic universe gate',
  evidence: '3. Evidence eligibility gate',
  ranking: '4. Ranking preferences',
  audit: '5. Adversarial constraint audit',
} as const;

const authorityLabels = {
  context_only: 'Context only',
  deterministic_gate: 'Deterministic gate',
  evidence_gate: 'Evidence required',
  ranking_only: 'Ranking only',
  adversarial_review: 'Cross-check',
} as const;

export function ThesisDiscoveryPreview({ criteria }: { criteria: ThesisCriteria }) {
  return <div className="thesis-summary">
    <h3>How the strategy will be enforced</h3>
    <p className="note">Constraints are evaluated by domain. Deterministic and evidence gates can affect eligibility; preferences only affect ranking; portfolio context never excludes a security. The final audit checks conflicts and missing evidence before research synthesis.</p>
    {thesisDiscoveryPlan(criteria).map((plan,index)=><article className="thesis-mandate" key={`${plan.role}-${index}`}>
      <h4>{plan.name} · {plan.reportingCurrency}</h4>
      <p>{plan.objective}</p>
      {(plan.strategy || plan.horizon || plan.benchmark) && <p>Strategy: {plan.strategy || 'not specified'} · Horizon: {plan.horizon || 'not specified'} · Benchmark: {plan.benchmark || 'none'}</p>}
      {(plan.targetHoldings || plan.maximumHoldings) && <p>Holdings: target {plan.targetHoldings ?? 'not specified'}, maximum {plan.maximumHoldings ?? 'not specified'}</p>}
      <p><strong>Search coverage:</strong> {plan.searchMarkets.join(', ') || 'No automated market configured'}. Reporting currency does not establish company geography.</p>

      <div className="thesis-evaluation-flow" aria-label="Constraint evaluation pipeline">
        {plan.evaluationClusters.map(cluster=><section key={cluster.id} className="thesis-rule-cluster">
          <div className="section-heading"><strong>{clusterLabels[cluster.id]}</strong><span className="badge">{authorityLabels[cluster.authority]}</span></div>
          {cluster.items.length ? <ul>{cluster.items.map((item,itemIndex)=><li key={`${cluster.id}-${itemIndex}`}>{item}</li>)}</ul> : <p className="note">No rules in this cluster.</p>}
        </section>)}
      </div>

      {plan.universe && <details><summary>Structured universe fields</summary><dl>{Object.entries(plan.universe).filter(([,values])=>values.length).map(([field,values])=><div key={field}><dt>{field.replace(/([A-Z])/g,' $1')}</dt><dd>{values.join(', ')}</dd></div>)}</dl></details>}
      {plan.hardConstraints.length > 0 && <details><summary>Hard eligibility rules ({plan.hardConstraints.length})</summary><ul>{plan.hardConstraints.map((rule,ruleIndex)=><li key={ruleIndex}>{rule.statement}{rule.metric && ` (${rule.metric.field} ${rule.metric.operator==='gte'?'≥':'≤'} ${rule.metric.value} ${rule.metric.unit}, ${rule.metric.period})`}{rule.predicate && ` (${rule.predicate.mode}: ${rule.predicate.field} ${rule.predicate.operator==='eq'?'=':'≠'} ${rule.predicate.value}${rule.predicate.mode==='evidence'?', source-backed':''})`}</li>)}</ul></details>}
      {(plan.legacyPreferences.length > 0 || plan.exclusions.length > 0) && <details><summary>Legacy prose still requiring classification</summary>{plan.legacyPreferences.length > 0 && <p><strong>Preferences:</strong> {plan.legacyPreferences.join(' · ')}</p>}{plan.exclusions.length > 0 && <p><strong>Exclusions:</strong> {plan.exclusions.join(' · ')}</p>}</details>}
      <p className="note">{plan.evidencePolicy}</p>
    </article>)}
  </div>;
}
