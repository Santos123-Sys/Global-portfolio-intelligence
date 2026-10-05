import { z } from 'zod';
import { PROTECTED_AGENT_POLICY, rolePolicy } from '@portfolio-intelligence/agentic-contract';
import type { EffectiveAgentConfig } from '@/lib/agent-governance';
import { evidenceOutput, type AgentOutput, type AnalyzeRequest } from '../contracts';
import { generateAgentOutput } from '../l2/model-router';
import { hasModelRuntime, requestModelResponse } from '../l2/model-runtime';
import { sourceEvidence, type Foundation } from '../l4/foundation';
import { inferResearchMarket } from '../research-policy';

const perspectiveSchema = z.enum(['industry', 'competition', 'management', 'risk', 'countercase', 'evidence']);
export const dynamicResearchTaskSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(48),
  label: z.string().trim().min(3).max(80),
  objective: z.string().trim().min(10).max(500),
  focusKeywords: z.array(z.string().trim().min(2).max(60)).min(2).max(10),
  perspective: perspectiveSchema,
  priority: z.enum(['high', 'medium', 'low']),
}).strict();
export type DynamicResearchTask = z.infer<typeof dynamicResearchTaskSchema>;

export const dynamicResearchPlanSchema = z.object({
  version: z.literal('dynamic-research-v1'),
  source: z.enum(['model', 'fallback']),
  maxParallel: z.number().int().min(0).max(12),
  researchAsOf: z.string().nullable(),
  tasks: z.array(dynamicResearchTaskSchema).max(12),
}).strict();
export type DynamicResearchPlan = z.infer<typeof dynamicResearchPlanSchema>;

const PLAN_JSON_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['tasks'],
  properties: {
    tasks: {
      type: 'array', minItems: 1, maxItems: 12,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'label', 'objective', 'focusKeywords', 'perspective', 'priority'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
          label: { type: 'string' }, objective: { type: 'string' },
          focusKeywords: { type: 'array', minItems: 2, maxItems: 10, items: { type: 'string' } },
          perspective: { type: 'string', enum: ['industry', 'competition', 'management', 'risk', 'countercase', 'evidence'] },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
} as const;

export function dynamicResearchBudget(type: AnalyzeRequest['analysisType']): number {
  if (type === 'dcf') return 0;
  if (type === 'quick') return 3;
  if (type === 'fundamental') return 6;
  return 8;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'research-task';
}

function task(label: string, objective: string, focusKeywords: string[], perspective: DynamicResearchTask['perspective'], priority: DynamicResearchTask['priority'] = 'medium'): DynamicResearchTask {
  return dynamicResearchTaskSchema.parse({ id: slug(label), label, objective, focusKeywords, perspective, priority });
}

function fallbackTasks(foundation: Foundation, type: AnalyzeRequest['analysisType'], maxTasks: number): DynamicResearchTask[] {
  if (!maxTasks) return [];
  const sector = String(foundation.company.sector ?? '').toLowerCase();
  const ticker = foundation.company.ticker;
  const general: DynamicResearchTask[] = [
    task('Competitive position', `Assess ${ticker}'s competitive position, peer differentiation, market share evidence and structural advantages without inferring missing market data.`, [ticker, 'competitor', 'peer', 'market share', 'moat'], 'competition', 'high'),
    task('Demand and industry structure', `Assess the demand drivers, industry lifecycle, pricing/volume/mix evidence and relevant market-structure signals for ${ticker}.`, [ticker, 'demand', 'industry', 'market', 'pricing', 'volume'], 'industry', 'high'),
    task('Management and capital allocation', `Assess management execution, guidance discipline and capital allocation using retained issuer evidence. Separate observed actions from interpretation.`, [ticker, 'management', 'guidance', 'capital allocation', 'buyback', 'dividend'], 'management'),
    task('Risk and regulatory pressure', `Search the retained evidence for material regulatory, legal, geographic, customer, supplier and operating risks that could break the investment thesis.`, [ticker, 'risk', 'regulation', 'legal', 'supplier', 'customer'], 'risk', 'high'),
    task('Independent countercase', `Develop an evidence-backed challenge to the apparent investment thesis for ${ticker}; prioritize contradictory evidence and missing assumptions rather than duplicating the later bull/bear debate.`, [ticker, 'risk', 'decline', 'competition', 'margin', 'cash flow'], 'countercase', 'high'),
    task('Evidence gaps and contradictions', `Identify the most decision-relevant missing evidence, stale inputs and contradictions across filings, news, estimates and peer information for ${ticker}.`, [ticker, 'estimate', 'filing', 'news', 'guidance', 'peer'], 'evidence'),
  ];
  const sectorTasks: DynamicResearchTask[] = [];
  if (/(bank|financial|insurance|capital markets)/.test(sector)) {
    sectorTasks.push(
      task('Credit and funding quality', 'Assess asset quality, credit-loss indicators, funding mix, liquidity and deposit or financing sensitivity where evidence exists.', ['credit', 'loan', 'deposit', 'liquidity', 'funding', 'provision'], 'risk', 'high'),
      task('Capital and regulatory resilience', 'Assess capital adequacy, regulatory constraints and balance-sheet resilience without inventing jurisdictional thresholds.', ['capital', 'CET1', 'regulatory', 'solvency', 'liquidity'], 'risk')
    );
  } else if (/(semiconductor|software|technology|hardware|internet)/.test(sector)) {
    sectorTasks.push(
      task('Technology demand and capex cycle', 'Assess customer capex, product-cycle demand, adoption and inventory-cycle evidence relevant to the issuer.', ['capex', 'demand', 'inventory', 'adoption', 'product cycle'], 'industry', 'high'),
      task('Platform and supply-chain dependence', 'Assess platform lock-in, supplier concentration, foundry or infrastructure dependence and export/regulatory exposure.', ['platform', 'supplier', 'foundry', 'supply chain', 'export', 'regulation'], 'risk')
    );
  } else if (/(pharma|biotech|health|medical)/.test(sector)) {
    sectorTasks.push(
      task('Pipeline and patent durability', 'Assess pipeline concentration, patent or exclusivity exposure and evidence around major clinical or product milestones.', ['pipeline', 'patent', 'clinical', 'trial', 'approval', 'exclusivity'], 'risk', 'high'),
      task('Reimbursement and regulatory risk', 'Assess reimbursement, regulatory and commercialization dependencies using retained evidence only.', ['reimbursement', 'regulatory', 'approval', 'pricing', 'commercialization'], 'risk')
    );
  } else if (/(energy|oil|gas|mining|materials|chemical)/.test(sector)) {
    sectorTasks.push(
      task('Commodity and cost-curve exposure', 'Assess sensitivity to commodity prices, production mix, realized pricing and cost-curve positioning from retained evidence.', ['commodity', 'production', 'price', 'cost', 'margin', 'reserve'], 'industry', 'high'),
      task('Reserve and capital discipline', 'Assess reserve/resource life, sustaining versus growth capex and capital discipline without creating unsourced forecasts.', ['reserve', 'resource', 'capex', 'production', 'capital allocation'], 'management')
    );
  } else if (/(consumer|retail|food|beverage|apparel|household)/.test(sector)) {
    sectorTasks.push(
      task('Pricing power and volume mix', 'Assess pricing power, elasticity, unit volume, product mix and channel evidence relevant to revenue quality.', ['pricing', 'volume', 'mix', 'channel', 'consumer', 'brand'], 'industry', 'high'),
      task('Brand and channel durability', 'Assess brand strength, distribution reach, retailer/channel concentration and competitive substitution risks.', ['brand', 'distribution', 'channel', 'retailer', 'competition'], 'competition')
    );
  } else if (/(utility|infrastructure|telecom)/.test(sector)) {
    sectorTasks.push(
      task('Regulated returns and capital program', 'Assess regulatory framework, allowed economics, capital program execution and financing dependence from retained evidence.', ['regulatory', 'tariff', 'capex', 'return', 'debt', 'financing'], 'industry', 'high'),
      task('Demand and network resilience', 'Assess demand stability, network utilization and operational resilience using issuer and industry evidence.', ['demand', 'network', 'utilization', 'reliability', 'customer'], 'risk')
    );
  }
  const gapTask = foundation.dataGaps.length
    ? [task('Known data gaps', `Investigate the retained evidence around known gaps: ${foundation.dataGaps.slice(0, 4).join('; ')}`, ['gap', 'estimate', 'forecast', 'source', ticker], 'evidence', 'high')]
    : [];
  const ordered = [...sectorTasks, ...general, ...gapTask];
  const unique = new Map<string, DynamicResearchTask>();
  for (const item of ordered) if (!unique.has(item.id)) unique.set(item.id, item);
  return [...unique.values()].slice(0, maxTasks);
}

function normalizeModelTasks(raw: unknown, maxTasks: number): DynamicResearchTask[] {
  const parsed = z.object({ tasks: z.array(dynamicResearchTaskSchema) }).safeParse(raw);
  if (!parsed.success) return [];
  const unique = new Map<string, DynamicResearchTask>();
  for (const item of parsed.data.tasks) {
    const id = slug(item.id || item.label);
    if (!unique.has(id)) unique.set(id, { ...item, id });
    if (unique.size >= maxTasks) break;
  }
  return [...unique.values()];
}

export async function planDynamicResearchSwarm(foundation: Foundation, analysisType: AnalyzeRequest['analysisType'], config?: EffectiveAgentConfig): Promise<DynamicResearchPlan> {
  const maxTasks = dynamicResearchBudget(analysisType);
  const fallback = fallbackTasks(foundation, analysisType, maxTasks);
  if (!maxTasks) return dynamicResearchPlanSchema.parse({ version: 'dynamic-research-v1', source: 'fallback', maxParallel: 0, researchAsOf: foundation.fiscalDate, tasks: [] });
  if (!hasModelRuntime()) return dynamicResearchPlanSchema.parse({ version: 'dynamic-research-v1', source: 'fallback', maxParallel: maxTasks, researchAsOf: foundation.fiscalDate, tasks: fallback });
  const policy = config?.runtimePolicy;
  try {
    const market = inferResearchMarket(foundation.company);
    const response = await requestModelResponse({
      model: policy?.model ?? process.env.OPENAI_MODEL ?? 'gpt-6-sol', reasoning: { effort: policy?.reasoningEffort ?? 'medium' },
      input: [
        { role: 'system', content: `${config?.protectedPolicy ?? PROTECTED_AGENT_POLICY}\nYou are the Research Director's decomposition planner. Create bounded, independent research subtasks for parallel execution. Do not make investment conclusions, factual claims, valuations or trading recommendations. Avoid duplicate tasks and spurious parallelism. Use the sector, thesis, evidence inventory and known gaps to select only tasks that can materially improve the research. Include at least one explicit risk/countercase task for deep research. Return task definitions only.` },
        { role: 'user', content: JSON.stringify({ ticker: foundation.company.ticker, sector: foundation.company.sector, market, currency: foundation.company.currency, analysisType, maxTasks, thesis: foundation.thesisContext, dataGaps: foundation.dataGaps.slice(0, 12), peerCount: foundation.peers.length, estimateCount: foundation.estimates.length, documents: foundation.documents.map(row => ({ title: row.title, type: row.type, publishedAt: row.publishedAt })).slice(0, 25), marketBriefAvailable: !!foundation.marketBrief }) },
      ],
      text: { format: { type: 'json_schema', name: 'dynamic_research_plan', strict: true, schema: PLAN_JSON_SCHEMA } },
      max_output_tokens: Math.min(policy?.maxOutputTokens ?? 4000, 2500),
    }, Math.min(policy?.timeoutMs ?? 60_000, 60_000));
    if (!response.ok) throw new Error(`Planner request failed (${response.status})`);
    const body = await response.json() as { output?: Array<{ content?: Array<{ type: string; text?: string }> }> };
    const text = body.output?.flatMap(row => row.content ?? []).filter(row => row.type === 'output_text').map(row => row.text ?? '').join('');
    const modelTasks = normalizeModelTasks(JSON.parse(text ?? '{}'), maxTasks);
    const tasks = modelTasks.length ? modelTasks : fallback;
    return dynamicResearchPlanSchema.parse({ version: 'dynamic-research-v1', source: modelTasks.length ? 'model' : 'fallback', maxParallel: maxTasks, researchAsOf: foundation.fiscalDate, tasks });
  } catch {
    return dynamicResearchPlanSchema.parse({ version: 'dynamic-research-v1', source: 'fallback', maxParallel: maxTasks, researchAsOf: foundation.fiscalDate, tasks: fallback });
  }
}

function selectedEvidence(taskDefinition: DynamicResearchTask, foundation: Foundation): Record<string, string> {
  const all = sourceEvidence(foundation);
  const terms = [taskDefinition.label, taskDefinition.objective, ...taskDefinition.focusKeywords, foundation.company.ticker, String(foundation.company.sector ?? '')]
    .join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(term => term.length >= 3);
  const scored = Object.entries(all).map(([citation, text]) => {
    const haystack = `${citation} ${text.slice(0, 12000)}`.toLowerCase();
    let score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
    if (/(sec\.gov|cvm|investor|annual|quarter|results|filing)/i.test(citation)) score += 2;
    return { citation, text, score };
  }).sort((a, b) => b.score - a.score || a.citation.localeCompare(b.citation));
  const relevant = scored.filter(row => row.score > 0);
  const chosen = (relevant.length >= 4 ? relevant : scored).slice(0, 10);
  return Object.fromEntries(chosen.map(row => [row.citation, row.text.slice(0, 6000)]));
}

export async function runDynamicResearchSpecialist(taskDefinition: DynamicResearchTask, foundation: Foundation, prior: Record<string, AgentOutput>, config?: EffectiveAgentConfig): Promise<AgentOutput> {
  const evidence = selectedEvidence(taskDefinition, foundation);
  const citations = Object.keys(evidence);
  if (!citations.length) return evidenceOutput({ taskId: taskDefinition.id, label: taskDefinition.label, findings: [], contradictions: [], uncertainties: [], missingInputs: ['No retained evidence matched this research task.'], thesisImplications: [] }, ['The bounded specialist found no attributable retained evidence for its assigned scope.'], [], ['No retained evidence matched this dynamic research task.'], 0);
  const market = inferResearchMarket(foundation.company);
  return generateAgentOutput({
    generalConfiguration: JSON.stringify({ ticker: foundation.company.ticker, market, sector: foundation.company.sector, currency: foundation.company.currency, fiscalDate: foundation.fiscalDate, task: taskDefinition }),
    profiling: `${config?.protectedPolicy ?? rolePolicy('dynamic-research-specialist')}\nTEMPORARY ASSIGNMENT: ${taskDefinition.objective}\nWork independently. Do not infer consensus from other agents. Surface contradictory evidence and missing inputs. This is research-only and cannot approve, trade, change weights or alter deterministic calculations.`,
    perception: {
      task: taskDefinition,
      thesis: foundation.thesisContext,
      sourceEvidence: evidence,
      deterministicContext: {
        financialStatementAnalysis: prior['financial-statement-analyzer'] ?? null,
        marketStructure: prior['market-industry-research'] ?? null,
      },
      evidenceAsOf: foundation.fiscalDate,
    },
    action: 'Return AgentOutput JSON. dataJson must encode taskId, label, findings (string[]), contradictions (string[]), uncertainties (string[]), missingInputs (string[]) and thesisImplications (string[]). Every material factual assertion requires an exact retained-source excerpt and citation. Do not calculate valuation, invent market size, or convert uncertainty into a conclusion.',
  }, citations, config);
}

export function summarizeDynamicResearch(plan: DynamicResearchPlan, outputs: Record<string, AgentOutput>) {
  const entries = plan.tasks.map(taskDefinition => ({
    taskId: taskDefinition.id,
    label: taskDefinition.label,
    objective: taskDefinition.objective,
    perspective: taskDefinition.perspective,
    priority: taskDefinition.priority,
    output: outputs[`dynamic-research-${taskDefinition.id}`] ?? null,
  }));
  return {
    plan,
    completed: entries.filter(row => row.output?.status === 'completed').length,
    needsAttention: entries.filter(row => row.output && row.output.status !== 'completed').length,
    tasks: entries,
  };
}
