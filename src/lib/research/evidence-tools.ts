import { createHash } from 'node:crypto';
import type { ScreenResult } from '../foundation/screening';
import type { IssuerStatementV1 } from '../integrations/issuer-statement-client';
import { ToolRequest, type Evidence, type ResearchBrief } from './contracts';

/** Inputs are server-validated FilingLens responses, never a browser-supplied fact pack. */
export function collectEvidence(screen: ScreenResult, brief: ResearchBrief, issuer?: IssuerStatementV1 | null): Evidence[] {
  const identity = screen.candidate.issuer;
  const rows: Evidence[] = [];
  if (identity && screen.finance.status === 'ready') {
    const snapshot = screen.finance.snapshot;
    if (snapshot.issuer.jurisdiction !== identity.jurisdiction || snapshot.issuer.registryId !== identity.registryId)
      throw new Error('research_issuer_mismatch');
    for (const fact of snapshot.facts) {
      if (fact.value === null || !['verified', 'single_source'].includes(fact.status)) continue;
      rows.push({ id: fact.id, metric: fact.metric, fiscalYear: fact.fiscalYear,
        sourceKind: 'public_regulatory', sourceUrl: fact.sources[0].url,
        text: JSON.stringify({ issuer: snapshot.issuer, metric: fact.metric, value: fact.value, unit: fact.unit,
          currency: fact.currency, fiscalYear: fact.fiscalYear, periodEnd: fact.periodEnd,
          status: fact.status, sourceKind: 'public_regulatory', sources: fact.sources }) });
    }
  }
  if (issuer) {
    if (!identity || identity.jurisdiction !== issuer.issuer.jurisdiction || identity.registryId !== issuer.issuer.registryId)
      throw new Error('research_issuer_mismatch');
    for (const fact of issuer.facts) {
      const text = JSON.stringify({ issuer: issuer.issuer, ...fact, sourceKind: issuer.provenance,
        secCompanyFactsVerified: false, source: issuer.source });
      rows.push({ id: createHash('sha256').update(text).digest('hex'), metric: fact.metric,
        fiscalYear: fact.fiscalYear, text, sourceUrl: issuer.source.url, sourceKind: issuer.provenance });
    }
  }
  const result = rows.filter(row => row.fiscalYear >= brief.startYear && row.fiscalYear <= brief.endYear);
  if (new Set(result.map(row => row.id)).size !== result.length) throw new Error('duplicate_research_evidence');
  // Bound actual bytes before a model receives the corpus. No silent first-N truncation.
  if (result.length > 80 || Buffer.byteLength(JSON.stringify(result)) > 48_000) throw new Error('research_evidence_budget');
  return result;
}

export function coverageGaps(evidence: Evidence[], brief: ResearchBrief): string[] {
  const present = new Set(evidence.map(row => row.fiscalYear));
  const missing = Array.from({ length: brief.endYear - brief.startYear + 1 }, (_, i) => brief.startYear + i).filter(y => !present.has(y));
  return [
    ...(missing.length ? [`No usable financial records for requested fiscal years: ${missing.join(', ')}.`] : []),
    evidence.some(e=>e.documentId) ? 'Narrative passages are retrieved from the scoped document library. Quotes use extracted-text offsets; uploaded issuer/period labels require review.' : 'No matching document passages were retrieved. Import company/year filings or acquire official sources.',
    'Record availability is not proof of complete statements, comparable periods or support for causal explanations.',
    ...(evidence.some(e => e.sourceKind === 'issuer_published_unaudited_pdf')
      ? ['Issuer-published unaudited evidence is a separate source tier, not SEC CompanyFacts verification.'] : []),
  ];
}

/** No generic fetch/SQL/shell/file tool. Arguments cannot change company, dates or permissions. */
export function executeEvidenceTool(value: unknown, evidence: Evidence[], brief: ResearchBrief) {
  const request = ToolRequest.parse(value);
  if (request.tool === 'inspect_coverage') return { tool: request.tool, evidence: [] as Evidence[],
    gaps: coverageGaps(evidence, brief), metrics: [...new Set(evidence.map(e => e.metric))] };
  const terms = request.query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const ranked = evidence.map(row => ({ row, score: terms.reduce((n, term) => n + Number(row.text.toLocaleLowerCase().includes(term)), 0) }))
    .filter(hit => hit.score > 0).sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));
  return { tool: request.tool, evidence: ranked.slice(0, 24).map(hit => hit.row), gaps: [] as string[], metrics: [] as string[] };
}
