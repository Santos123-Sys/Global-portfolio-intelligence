import { z } from 'zod';
import type { ScreenResult } from './screening';
const Claim = z.object({ text: z.string().min(1).max(700).refine(t => !/\d|[$€£%]/.test(t), 'Numeric claims must be rendered from evidence, not generated'),
  evidenceIds: z.array(z.string().min(1)).min(1).max(8), falsifier: z.string().min(1).max(400).refine(t => !/\d|[$€£%]/.test(t)) }).strict();
export const ResearchDraft = z.object({ bull: z.array(Claim).min(1).max(4), bear: z.array(Claim).min(1).max(4),
  conclusion: z.enum(['review', 'insufficient_evidence']), gaps: z.array(z.string().max(300)).max(10) }).strict();
export type ResearchDraft = z.infer<typeof ResearchDraft>;
export function validateResearchDraft(value: unknown, screen: ScreenResult): ResearchDraft {
  const draft = ResearchDraft.parse(value);
  const supported = new Set(screen.finance.status === 'ready' ? screen.finance.snapshot.facts
    .filter(f => f.value !== null && ['verified', 'single_source'].includes(f.status)).map(f => f.id) : []);
  for (const claim of [...draft.bull, ...draft.bear]) {
    if (new Set(claim.evidenceIds).size !== claim.evidenceIds.length || claim.evidenceIds.some(id => !supported.has(id)))
      throw new Error('unsupported_research_evidence');
  }
  return draft;
}
/** Reproducible evidence pack, not a pretend AI recommendation. */
export function researchWorkbench(screen: ScreenResult, draft: ResearchDraft | null = null) {
  return { candidate: screen.candidate, screen, draft, approval: 'human_review_required', financialAuthority: 'FilingLens',
    valuation: { status: 'external_only', reason: 'Valuation must be performed in FilingLens; no valuation endpoint is assumed.' },
    questions: {
      bull: ['Which supplied facts support durable growth or competitive advantage?', 'What observation would falsify the positive case?'],
      bear: ['Which supplied facts challenge the positive case?', 'What evidence would resolve the strongest downside uncertainty?'],
      review: ['Are sources, fiscal periods and units comparable?', 'Which claims remain hypotheses rather than established facts?'],
    },
    limitations: ['Public regulatory evidence only; private uploads are not shared.', 'No orders, portfolio sizing or automatic approval.',
      'Citations establish lineage, not semantic truth. Every generated claim needs human review.', ...screen.decisions.filter(d => d.status === 'UNKNOWN').map(d => d.reason)],
  };
}
