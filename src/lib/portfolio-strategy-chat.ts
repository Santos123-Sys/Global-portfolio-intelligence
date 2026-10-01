import { z } from 'zod';
import { ThesisPolicy } from '@portfolio-intelligence/agentic-contract';

const label = (maximum: number) => z.string().trim().min(1).max(maximum);
const line = z.string().trim().min(1).max(500);

export const PortfolioStrategyDraft = z.object({
  title: label(120),
  investorName: z.string().trim().max(120).default(''),
  purpose: label(2_000),
  timeHorizon: label(120),
  riskTolerance: label(240),
  reviewCadence: label(120),
  markets: z.array(line).min(1).max(12),
  globalConstraints: z.array(line).max(30),
  mandates: z.array(z.object({
    label: label(100),
    role: z.string().trim().min(2).max(64).regex(/^[a-z][a-z0-9_]*$/),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    objective: label(1_000),
    inclusionCriteria: z.array(line).max(30),
    exclusionCriteria: z.array(line).max(30),
    policy: ThesisPolicy,
  }).strict()).min(1).max(8),
}).strict();
export type PortfolioStrategyDraft = z.infer<typeof PortfolioStrategyDraft>;

export const StrategyChatRequest = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(4_000) }).strict()).min(1).max(24),
  currentDraft: PortfolioStrategyDraft.nullable().optional(),
  nextVersion: z.number().int().positive(),
}).strict();

export const StrategyChatResponse = z.object({
  reply: z.string().trim().min(1).max(1_500),
  status: z.enum(['clarifying', 'ready']),
  missingFields: z.array(z.string().trim().min(1).max(200)).max(8),
  draft: PortfolioStrategyDraft.nullable(),
}).strict().superRefine((response, context) => {
  if (response.status === 'ready' && !response.draft) context.addIssue({ code: 'custom', path: ['draft'], message: 'A ready response must include the complete strategy draft' });
  if (response.status === 'clarifying' && response.draft) context.addIssue({ code: 'custom', path: ['draft'], message: 'A clarification response cannot be approved as a complete draft' });
  if (response.status === 'ready' && response.missingFields.length) context.addIssue({ code: 'custom', path: ['missingFields'], message: 'A ready response cannot have missing decision fields' });
});
export type StrategyChatResponse = z.infer<typeof StrategyChatResponse>;

export function criteriaFromPortfolioStrategy(draft: PortfolioStrategyDraft, version: number) {
  const baseConstraints = [...draft.globalConstraints];
  if (draft.riskTolerance) baseConstraints.push(`Risk posture: ${draft.riskTolerance}`);
  if (draft.reviewCadence) baseConstraints.push(`Review cadence: ${draft.reviewCadence}`);
  return {
    version,
    portfolios: draft.mandates.map((mandate) => ({
      role: mandate.role,
      currency: mandate.currency,
      objective: mandate.objective,
      inclusionCriteria: mandate.inclusionCriteria,
      exclusionCriteria: mandate.exclusionCriteria,
      policy: mandate.policy,
    })),
    globalConstraints: [...new Set(baseConstraints)],
  };
}

export function strategyPdfTitleFromCriteria(criteria: {
  portfolios: Array<{ role: string; policy?: { name?: string } }>;
}): string {
  return criteria.portfolios[0]?.policy?.name?.trim() || `${criteria.portfolios[0]?.role.replaceAll('_', ' ') || 'Portfolio'} strategy`;
}
