import { z } from 'zod';

export const ResearchBrief = z.object({
  question: z.string().trim().min(20).max(1600),
  startYear: z.number().int().min(2000).max(2200),
  endYear: z.number().int().min(2000).max(2200),
  language: z.enum(['en', 'pt']),
  acquireMissing: z.boolean().optional(),
}).strict().refine(b => b.endYear >= b.startYear && b.endYear - b.startYear <= 10,
  'Use an ordered research window of at most eleven fiscal years');
export type ResearchBrief = z.infer<typeof ResearchBrief>;
export const ToolRequest = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('search_evidence'), query: z.string().trim().min(1).max(300) }).strict(),
  z.object({ tool: z.literal('inspect_coverage') }).strict(),
]);
export const ResearchPlan = z.object({
  questions: z.array(z.string().trim().min(10).max(300)).min(1).max(4),
  tools: z.array(ToolRequest).min(1).max(5),
}).strict();
const qualitative = z.string().trim().min(10).max(700)
  .refine(t => !/\p{N}|[$€£%]|https?:\/\//u.test(t), 'Narrative cannot introduce numbers or URLs');
export const Finding = z.object({
  perspective: z.enum(['supporting', 'challenging']),
  kind: z.enum(['observation', 'hypothesis']),
  text: qualitative,
  citations: z.array(z.object({ evidenceId: z.string().min(1).max(200), quote: z.string().min(10).max(1500) }).strict()).min(1).max(4),
  falsifier: qualitative,
}).strict();
export const Findings = z.object({ findings: z.array(Finding).max(6),
  gaps: z.array(z.string().trim().min(1).max(400)).max(8) }).strict();
export const Critique = z.object({ reviews: z.array(z.object({
  findingIndex: z.number().int().min(0).max(5),
  verdict: z.enum(['supported', 'unsupported', 'uncertain']),
  reason: z.string().trim().min(10).max(400),
}).strict()).max(6) }).strict();
export type Evidence = {
  id: string; metric: string; fiscalYear: number; text: string; sourceUrl: string;
  sourceKind: 'public_regulatory' | 'issuer_published_unaudited_pdf' | 'regulator_download' | 'user_upload' | 'issuer_download';
  documentId?: string; locator?: string;
};
export type ResearchRun = {
  architecture: 'bounded-research-manager-v1'; promptVersion: string;
  brief: ResearchBrief; status: 'needs_sources' | 'model_disabled' | 'needs_human_review' | 'failed_closed';
  plan: z.infer<typeof ResearchPlan> | null;
  evidence: Evidence[]; findings: z.infer<typeof Finding>[]; gaps: string[];
  trace: { stage: string; status: string; elapsedMs: number; count?: number; usage?: unknown }[];
  modelCalls: number; stopReason: string;
};
