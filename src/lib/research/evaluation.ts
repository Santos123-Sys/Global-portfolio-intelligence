import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DocumentMeta, retrieveDocuments, type CorpusDocument } from '../corpus/documents';
import { Candidate, defaultProfile } from '../foundation/contracts';
import { screenCandidate } from '../foundation/screening';
import { FilingLensIssuer } from '../integrations/filinglens-contract';
import { ResearchBrief } from './contracts';
import { researchPrompts, type ResearchPromptProfile } from './rubric';

export const ResearchEvaluationDataset = z.object({
  schemaVersion: z.literal('research-rubric-evaluation.v1'),
  kind: z.enum(['synthetic_controls', 'reviewer_supplied_sources']),
  description: z.string().min(20).max(1000),
  cases: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]{1,100}$/),
    issuer: FilingLensIssuer, company: z.string().min(1).max(160), brief: ResearchBrief,
    documents: z.array(z.object({ metadata: DocumentMeta, text: z.string().max(2_000_000) }).strict()).max(10),
    expected: z.enum(['abstain', 'review_conditional_findings']),
    reviewChecks: z.array(z.string().min(10).max(500)).min(1).max(10),
  }).strict()).min(1).max(24),
}).strict().superRefine((dataset, ctx) => {
  if (new Set(dataset.cases.map(row => row.id)).size !== dataset.cases.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate evaluation case IDs' });
});
export type ResearchEvaluationDataset = z.infer<typeof ResearchEvaluationDataset>;
export type ResearchEvaluationCase = ResearchEvaluationDataset['cases'][number];
export const evaluationHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function prepareEvaluationCase(row: ResearchEvaluationCase) {
  const market = row.issuer.jurisdiction;
  const candidate = Candidate.parse({ key: `${market === 'us' ? 'XNAS' : 'BVMF'}:EVAL`, ticker: 'EVAL',
    name: row.company, exchange: market === 'us' ? 'XNAS' : 'BVMF', market, issuer: row.issuer,
    identitySourceUrl: market === 'us' ? 'https://www.sec.gov/' : 'https://dados.cvm.gov.br/' });
  // This runner evaluates narrative research only, never invents financial facts or calls a data provider.
  const screen = screenCandidate(candidate, defaultProfile, { status: 'unavailable', reason: 'narrative_evaluation_only' });
  const narrative = retrieveDocuments(row.documents as CorpusDocument[], `${market}:${row.issuer.registryId}`, row.brief);
  return { screen, narrative };
}

export function planResearchEvaluation(value: unknown, trials: number) {
  const dataset = ResearchEvaluationDataset.parse(value);
  if (!Number.isInteger(trials) || trials < 1 || trials > 10) throw new Error('evaluation_trial_limit');
  const profiles: ResearchPromptProfile[] = ['baseline', 'curated'];
  return { dataset, manifest: {
    schemaVersion: dataset.schemaVersion, datasetKind: dataset.kind, datasetHash: evaluationHash(dataset),
    qualityVerdict: 'requires_human_review' as const,
    cases: dataset.cases.map(row => ({ id: row.id, caseHash: evaluationHash(row), language: row.brief.language,
      expected: row.expected, retrievedRecords: prepareEvaluationCase(row).narrative.length })),
    trials, plannedRuns: dataset.cases.length * trials * profiles.length,
    maximumModelCalls: dataset.cases.length * trials * profiles.length * 3,
    maximumCompletionTokens: dataset.cases.length * trials * profiles.length * 3 * 2400,
    profiles: profiles.map(profile => ({ profile, promptVersion: researchPrompts(profile).version,
      promptHash: evaluationHash(researchPrompts(profile)) })),
  } };
}
