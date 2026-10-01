import { z } from 'zod';
import { capitalSchema, driverSchema, simulationSchema } from './l4/financial-model';

export const outputSchema = z.object({
  status: z.enum(['completed', 'insufficient_data', 'blocked']),
  data: z.record(z.unknown()),
  reasoningChain: z.array(z.string().min(1)).min(1),
  confidenceScore: z.number().min(0).max(100),
  citations: z.array(z.string().min(1)), limitations: z.array(z.string()),
  claims: z.array(z.object({ text: z.string().min(1), citations: z.array(z.string()), evidence: z.string().min(1),kind:z.enum(['fact','inference','assumption']).optional(),period:z.string().nullable().optional(),currency:z.string().nullable().optional() })).optional(),
  runtimeMetadata:z.object({model:z.string(),inputTokens:z.number().nullable(),outputTokens:z.number().nullable(),latencyMs:z.number(),estimatedCost:z.number().nullable()}).optional(),
  dataQuality: z.object({
    status: z.enum(['verified', 'review_required', 'insufficient']),
    completeness: z.number().min(0).max(1),
    issues: z.array(z.string()),
    asOf: z.string().nullable(),
  }).optional(),
  sourceLineage: z.array(z.object({
    field: z.string().min(1), source: z.string().min(1), provider: z.string().min(1),
    asOf: z.string().nullable(), quality: z.enum(['primary', 'official_api', 'licensed_data', 'secondary', 'unknown']),
  })).optional(),
});
export type AgentOutput = z.infer<typeof outputSchema>;
const narrativeData=z.object({findings:z.array(z.string()),missingInputs:z.array(z.string())}).passthrough();
const judgeData=narrativeData.extend({investmentScore:z.number().min(0).max(100),thesisAlignmentScore:z.number().min(0).max(100),qualityScore:z.number().min(0).max(100),growthScore:z.number().min(0).max(100),riskScore:z.number().min(0).max(100),portfolioRole:z.string(),keyCatalysts:z.array(z.string()),keyRisks:z.array(z.string()),evidencedThesisBreakers:z.array(z.string()),monitoringTriggers:z.array(z.string()),unresolvedDisagreements:z.array(z.string()),swingFactors:z.array(z.string())});
export function validateRoleData(id:string,output:AgentOutput):AgentOutput {
  if(output.status==='completed') (id==='judge-agent' ? judgeData : narrativeData).parse(output.data);
  return output;
}
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
  researchProfile: z.object({
    market: z.enum(['BR', 'US', 'CH', 'EU', 'OTHER']).optional(),
    locale: z.enum(['pt-BR', 'en', 'de', 'es']).optional(),
  }).strict().optional(),
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
export const deterministicAgents = ['financial-statement-analyzer', 'market-industry-research'] as const;
export function executionPlan(type: AnalyzeRequest['analysisType']): string[] {
  return ['research-director', 'financial-statement-analyzer', ...(type!=='dcf' ? ['market-industry-research'] : []), ...(type === 'dcf' || type === 'combined' ? dcfAgents : []),
    ...(type !== 'dcf' ? type === 'quick' ? analysisAgents.slice(0, 6) : analysisAgents : [])];
}

export const authoritySchema = z.enum(['autonomous', 'notify', 'approval_required', 'human_only']);
export const consequenceSchema = z.enum(['low', 'medium', 'high', 'critical']);
export const sessionEventSchema = z.object({
  eventType: z.enum(['plan_created', 'phase_started', 'tool_started', 'tool_completed', 'finding', 'warning', 'approval_required', 'paused', 'resumed', 'failed', 'completed', 'cancelled']),
  summary: z.string().min(1).max(500),
  detail: z.string().max(4000).optional(),
  agent: z.string().max(80).optional(),
  authority: authoritySchema,
  consequence: consequenceSchema,
  reversible: z.boolean(),
  occurredAt: z.string().datetime(),
});
export type SessionEvent = z.infer<typeof sessionEventSchema>;
export function evidenceOutput(data: Record<string, unknown>, reasoningChain: string[], citations: string[], limitations: string[] = [], confidenceScore = 75): AgentOutput {
  return outputSchema.parse({ status: limitations.length ? 'insufficient_data' : 'completed', data, reasoningChain,
    citations, limitations, confidenceScore: citations.length ? confidenceScore : 0 });
}
