import { z } from 'zod';
import { capitalSchema, driverSchema, simulationSchema } from './l4/financial-model';

export const outputSchema = z.object({
  status: z.enum(['completed', 'insufficient_data', 'blocked']),
  data: z.record(z.unknown()),
  reasoningChain: z.array(z.string().min(1)).min(1),
  confidenceScore: z.number().min(0).max(100),
  citations: z.array(z.string().min(1)), limitations: z.array(z.string()),
  claims: z.array(z.object({ text: z.string().min(1), citations: z.array(z.string()), evidence: z.string().min(1) })).optional(),
});
export type AgentOutput = z.infer<typeof outputSchema>;
export const messageSchema = z.object({
  from: z.string().min(1), to: z.string().min(1),
  messageType: z.enum(['request', 'response', 'feedback', 'alert']),
  payload: z.unknown(), timestamp: z.string().datetime(), sessionId: z.string().uuid(),
});
export type AgentMessage = z.infer<typeof messageSchema>;
export const analyzeSchema = z.object({
  ticker: z.string().trim().min(1).max(32),
  analysisType: z.enum(['dcf', 'fundamental', 'combined', 'quick']),
  portfolioId: z.string().uuid().optional(),
  thesisVersionId: z.string().uuid().optional(),
  userOverrides: z.object({
    timeHorizon: z.number().int().min(5).max(10).optional(),
    discountRate: z.number().positive().max(.5).optional(),
    capitalInputs: capitalSchema.optional(),
    drivers: driverSchema.optional(),
    simulation: simulationSchema.optional(),
    assumptions: z.object({
      annualGrowthRate: z.number().min(-.5).max(.5).optional(),
      terminalGrowthRate: z.number().min(-.05).max(.05).optional(),
      taxRate: z.number().min(0).max(1).optional(),
      netDebt: z.number().finite().optional(),
      sharesOutstanding: z.number().positive().optional(),
    }).strict().optional(),
  }).strict().optional(),
}).strict();
export type AnalyzeRequest = z.infer<typeof analyzeSchema>;
export const dcfAgents = ['dcf-orchestrator', 'assumption-setter', 'growth-modeler', 'projection-builder', 'wacc-calculator', 'terminal-value', 'sensitivity-analyst', 'sanity-checker'] as const;
export const analysisAgents = ['analysis-director', 'fundamental-analyst', 'technical-analyst', 'sentiment-analyst', 'ratio-analyst', 'quality-analyst', 'bull-agent', 'bear-agent', 'judge-agent'] as const;
export function executionPlan(type: AnalyzeRequest['analysisType']): string[] {
  return ['research-director', ...(type === 'dcf' || type === 'combined' ? dcfAgents : []),
    ...(type !== 'dcf' ? type === 'quick' ? analysisAgents.slice(0, 6) : analysisAgents : [])];
}
export function evidenceOutput(data: Record<string, unknown>, reasoningChain: string[], citations: string[], limitations: string[] = [], confidenceScore = 75): AgentOutput {
  return outputSchema.parse({ status: limitations.length ? 'insufficient_data' : 'completed', data, reasoningChain,
    citations, limitations, confidenceScore: citations.length ? confidenceScore : 0 });
}
