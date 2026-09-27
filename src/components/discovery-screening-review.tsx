import type { DiscoveryContext, ScreeningAudit } from '@portfolio-intelligence/agentic-contract';
import type { z } from 'zod';

type Audit = z.infer<typeof ScreeningAudit>;
type Context = z.infer<typeof DiscoveryContext>;

export function DiscoveryScreeningReview({ audit, portfolios }: { audit?: Audit; portfolios: Array<{ portfolioId: string; portfolioName: string }> }) {
  if (!audit) return null;
  return <section className="discovery-screening" aria-label="Discovery research funnel">
    <h3>From supplied universe to shortlist</h3>
    <p className="note">Eligibility uses the saved, approved thesis. Unknown means evidence is missing, not that a company failed. Counts cover supplied records, not the entire market.</p>
    {portfolios.map(portfolio => {
      const rows = audit.records.filter(row => row.portfolioId === portfolio.portfolioId);
      const count = (status: Audit['records'][number]['status']) => rows.filter(row => row.status === status).length;
      return <div key={portfolio.portfolioId}>
        <h4>{portfolio.portfolioName}</h4>
        <p>{rows.length} considered · {count('eligible')} eligible for research · {count('ineligible')} failed constraints · {count('unverified')} unknown · {count('duplicate')} duplicate listings · {count('already_known')} already held or reviewed</p>
        <details><summary>Inspect eligibility and exclusions</summary>
          <ul>{rows.map(row => <li key={`${row.exchange}:${row.ticker}`}>
            <strong>{row.ticker} · {row.exchange}</strong> — {row.status.replaceAll('_', ' ')}
            {!!row.reasons.length && <p>{row.reasons.join('; ')}</p>}
            {row.rules.map((rule, i) => <p key={i}>{rule.status}: {rule.criterion} — {rule.reason}</p>)}
          </li>)}</ul>
        </details>
      </div>;
    })}
    <p className="note">{audit.researchAttempted} unique listings sent to research · {audit.researchFailed} retrieval failures · {audit.modelCalls} relevance assessments. Runtime: {(audit.elapsedMs / 1000).toFixed(1)} seconds. Research counts are retrieval operations, not provider requests including retries.</p>
  </section>;
}

export function DiscoveryCandidateContext({ context }: { context?: Context }) {
  if (!context) return null;
  return <details className="discovery-screening">
    <summary>Eligibility and evidence dates</summary>
    <p>Discovered from the structured listing universe. All configured hard checks passed; preferences remain subjects for review.</p>
    <ul>{context.eligibility.rules.map((rule, i) => <li key={i}>{rule.status}: {rule.criterion} — {rule.reason}</li>)}</ul>
    <p className="note">Source type describes provenance, not independent verification. Search results remain unclassified until reviewed. Retrieval date does not establish when a financial fact was true.</p>
    <ul>{context.evidence.map((evidence, i) => <li key={`${evidence.url}:${i}`}>
      <a className="text-link" href={evidence.url} target="_blank" rel="noreferrer">{evidence.provider} · {evidence.kind === 'structured_record' ? 'Structured record' : 'Search result'}</a>
      <p>{evidence.tier.replaceAll('_', ' ')} · retrieved {evidence.retrievedAt?.slice(0, 10) ?? 'unknown'} · published {evidence.publishedAt ?? 'unknown'}{evidence.observedAt ? ` · record as of ${evidence.observedAt.slice(0, 10)}` : ''}</p>
      {evidence.snippet && <p>{evidence.snippet}</p>}
    </li>)}</ul>
  </details>;
}
