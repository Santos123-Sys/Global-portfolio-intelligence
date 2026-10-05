import type { ThesisCriteria, ThesisRule } from '@portfolio-intelligence/agentic-contract';
import type { assessThesisReview } from '@/lib/thesis-review';

type ReviewState = ReturnType<typeof assessThesisReview>;

type RuleStatus = 'Enforced' | 'Evidence required' | 'Preference' | 'Context' | 'Needs classification';

type StrategyReviewConsoleProps = {
  review: ReviewState;
  criteria: ThesisCriteria;
};

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ruleStatus(rule: ThesisRule): RuleStatus {
  if (rule.kind === 'preference') return 'Preference';
  if (rule.kind === 'context') return 'Context';
  if (rule.predicate?.mode === 'evidence') return 'Evidence required';
  if (rule.metric || rule.predicate) return 'Enforced';
  return 'Needs classification';
}

function statusClass(status: RuleStatus): string {
  if (status === 'Enforced') return 'is-enforced';
  if (status === 'Evidence required') return 'is-evidence';
  if (status === 'Preference') return 'is-preference';
  if (status === 'Context') return 'is-context';
  return 'is-attention';
}

function ruleDetail(rule: ThesisRule): string {
  if (rule.metric) {
    return `${humanize(rule.metric.field)} ${rule.metric.operator} ${rule.metric.value}${rule.metric.unit ? ` ${rule.metric.unit}` : ''}${rule.metric.period ? ` · ${rule.metric.period}` : ''}`;
  }
  if (rule.predicate) {
    const source = rule.predicate.mode === 'evidence' && rule.predicate.sourceRequirement
      ? ` · ${humanize(rule.predicate.sourceRequirement)} source`
      : '';
    const freshness = rule.predicate.mode === 'evidence' && rule.predicate.maxAgeDays
      ? ` · ≤ ${rule.predicate.maxAgeDays} days old`
      : '';
    return `${humanize(rule.predicate.field)} ${rule.predicate.operator} ${String(rule.predicate.value)}${source}${freshness}`;
  }
  return rule.kind === 'preference'
    ? 'Used for ranking and comparative judgment; it does not automatically exclude a security.'
    : rule.kind === 'context'
      ? 'Informational mandate context; it does not act as a security-level filter.'
      : 'This hard rule still needs a machine-verifiable metric or evidence predicate.';
}

function RuleRow({ rule }: { rule: ThesisRule }) {
  const status = ruleStatus(rule);
  return <div className="strategy-rule-row">
    <div>
      <strong>{rule.statement}</strong>
      <p>{ruleDetail(rule)}</p>
    </div>
    <span className={`strategy-rule-status ${statusClass(status)}`}>{status}</span>
  </div>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="strategy-empty-state">{children}</p>;
}

export function StrategyReviewConsole({ review, criteria }: StrategyReviewConsoleProps) {
  const blocked = review.errors.length > 0;
  const needsAttention = !blocked && review.actionableIssues.length > 0;
  const overallStatus = blocked ? 'Blocked' : needsAttention ? 'Needs attention' : 'Ready';
  const portfolios = criteria.portfolios;
  const allRules = portfolios.flatMap((portfolio) => portfolio.policy?.rules ?? []);
  const eligibilityRules = allRules.filter((rule) => rule.kind === 'hard');
  const rankingRules = allRules.filter((rule) => rule.kind === 'preference');
  const contextRules = allRules.filter((rule) => rule.kind === 'context');
  const evidenceRules = eligibilityRules.filter((rule) => rule.predicate?.mode === 'evidence');
  const universeEntries = portfolios.flatMap((portfolio) => {
    if (!portfolio.policy) return [];
    return (Object.entries(portfolio.policy.universe) as Array<[string, string[]]>)
      .filter(([, values]) => values.length > 0)
      .map(([field, values]) => ({ portfolio: portfolio.policy?.name || humanize(portfolio.role), field, values }));
  });

  return <section className="strategy-console" aria-label="Strategy review console">
    <header className={`strategy-console-summary ${blocked ? 'is-blocked' : needsAttention ? 'is-attention' : 'is-ready'}`}>
      <div>
        <p className="analysis-eyebrow">Research Director review</p>
        <h3>{overallStatus}</h3>
        <p>
          {blocked
            ? 'Resolve the blocking mandate conflicts before this strategy can govern research.'
            : needsAttention
              ? 'The mandate is structurally valid, but one or more judgment or evidence items should be reviewed.'
              : 'The mandate is structured and ready to govern Discovery.'}
        </p>
      </div>
      <div className="strategy-console-counts" aria-label="Review summary">
        <span><strong>{review.errors.length}</strong> blockers</span>
        <span><strong>{review.actionableIssues.length}</strong> review items</span>
        <span><strong>{evidenceRules.length}</strong> evidence checks</span>
      </div>
    </header>

    <div className="strategy-console-grid">
      <article className="strategy-console-card">
        <div className="strategy-console-card-heading">
          <div><span className="strategy-cluster-index">01</span><h4>Mandate</h4></div>
          <span className="strategy-cluster-label">Context</span>
        </div>
        {portfolios.map((portfolio) => <div className="strategy-mandate-row" key={portfolio.role}>
          <div><strong>{portfolio.policy?.name || humanize(portfolio.role)}</strong><p>{portfolio.objective}</p></div>
          <span>{portfolio.currency}</span>
        </div>)}
        {criteria.globalConstraints.length > 0 && <div className="strategy-context-stack">
          {criteria.globalConstraints.map((constraint) => <span key={constraint}>{constraint}</span>)}
        </div>}
      </article>

      <article className="strategy-console-card">
        <div className="strategy-console-card-heading">
          <div><span className="strategy-cluster-index">02</span><h4>Universe</h4></div>
          <span className="strategy-cluster-label">Deterministic</span>
        </div>
        {universeEntries.length === 0 ? <EmptyState>No explicit universe constraints are configured.</EmptyState> : universeEntries.map((entry) => <div className="strategy-universe-row" key={`${entry.portfolio}:${entry.field}`}>
          <div><strong>{humanize(entry.field)}</strong><span>{entry.portfolio}</span></div>
          <p>{entry.values.join(' · ')}</p>
        </div>)}
      </article>

      <article className="strategy-console-card">
        <div className="strategy-console-card-heading">
          <div><span className="strategy-cluster-index">03</span><h4>Eligibility</h4></div>
          <span className="strategy-cluster-label">Hard gates</span>
        </div>
        {eligibilityRules.length === 0 ? <EmptyState>No hard security-level eligibility rules are configured.</EmptyState> : eligibilityRules.map((rule, index) => <RuleRow rule={rule} key={`${rule.statement}:${index}`} />)}
      </article>

      <article className="strategy-console-card">
        <div className="strategy-console-card-heading">
          <div><span className="strategy-cluster-index">04</span><h4>Ranking</h4></div>
          <span className="strategy-cluster-label">Preferences</span>
        </div>
        {rankingRules.length === 0 ? <EmptyState>No qualitative or quantitative ranking preferences are configured.</EmptyState> : rankingRules.map((rule, index) => <RuleRow rule={rule} key={`${rule.statement}:${index}`} />)}
      </article>

      <article className="strategy-console-card">
        <div className="strategy-console-card-heading">
          <div><span className="strategy-cluster-index">05</span><h4>Risk & context</h4></div>
          <span className="strategy-cluster-label">Guidance</span>
        </div>
        {contextRules.length === 0 ? <EmptyState>Portfolio-level context remains in the mandate summary above.</EmptyState> : contextRules.map((rule, index) => <RuleRow rule={rule} key={`${rule.statement}:${index}`} />)}
      </article>

      <article className="strategy-console-card strategy-evidence-card">
        <div className="strategy-console-card-heading">
          <div><span className="strategy-cluster-index">06</span><h4>Evidence checks</h4></div>
          <span className="strategy-cluster-label">Source-backed</span>
        </div>
        {evidenceRules.length === 0 ? <EmptyState>No hard evidence-dependent gates are configured.</EmptyState> : evidenceRules.map((rule, index) => <RuleRow rule={rule} key={`${rule.statement}:${index}`} />)}
        <p className="strategy-card-footnote">Missing or stale evidence for a hard gate remains unverified and cannot silently pass eligibility.</p>
      </article>
    </div>

    <section className="research-director-audit" aria-label="Research Director audit">
      <div className="research-director-audit-heading">
        <div><p className="analysis-eyebrow">Adversarial audit</p><h4>Research Director audit</h4></div>
        <span className={`strategy-rule-status ${blocked ? 'is-attention' : needsAttention ? 'is-evidence' : 'is-enforced'}`}>{overallStatus}</span>
      </div>
      {review.errors.length > 0 && <div className="audit-blockers"><strong>Blocking corrections</strong><ul>{review.errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
      {review.actionableIssues.length > 0 && <div className="audit-items"><strong>Items requiring judgment</strong>{review.actionableIssues.map((issue, index) => <div key={`${issue.location}:${index}`}>
        <p><strong>{issue.location}</strong> · {issue.statement}</p>
        <p>{issue.interpretation}</p>
        {issue.proxy && <p className="strategy-card-footnote">Possible proxy: {issue.proxy}</p>}
      </div>)}</div>}
      {!blocked && !needsAttention && <p className="strategy-audit-ready">No unresolved cross-domain conflicts were detected. Discovery can use this mandate after approval.</p>}
      {review.contextIssues.length > 0 && <details className="strategy-audit-details"><summary>Informational context ({review.contextIssues.length})</summary>{review.contextIssues.map((issue, index) => <p key={`${issue.location}:${index}`}><strong>{issue.location}:</strong> {issue.interpretation}</p>)}</details>}
    </section>
  </section>;
}
