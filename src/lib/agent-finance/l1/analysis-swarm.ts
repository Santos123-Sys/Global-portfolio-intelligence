import { evidenceOutput, validateRoleData, type AgentOutput } from '../contracts';
import { generateAgentOutput } from '../l2/model-router';
import {sourceEvidence, type Foundation } from '../l4/foundation';
import { technicalIndicators } from '../l4/technical';
import { inferResearchMarket, researchProviderPolicy } from '../research-policy';
import { rolePolicy } from '@portfolio-intelligence/agentic-contract';
import { selectPrior, type EffectiveAgentConfig } from '@/lib/agent-governance';
import { valueCriteriaSchema } from '../l4/research-modules';

const roles: Record<string, string> = {
  'market-industry-research': 'Assess market size using independent top-down and bottom-up evidence where available. Separate TAM, SAM and achievable share. Analyze volume/price/mix, market lifecycle, CR3/CR5, customer/supplier concentration and sector-appropriate demand drivers. Channel economics applies only where relevant. Do not force a generic consumer framework onto banks, utilities or industrials. Missing sizing/share evidence must be explicit, never estimated without sources.',
  'value-scorecard-analyst': 'Evaluate the supplied 20 criterion IDs in data.criteria exactly once. Each entry: id, score (1-5 or null), applicable (boolean), rationale, confidence (0-1), citations, evidence (exact retained source excerpt). Missing evidence requires null; not-applicable requires null and rationale. Assess relative to sector and the approved thesis. Do not reward every moat mechanism, high margins or dividends universally. Never manufacture a total score or investment action.',
  'fundamental-analyst': 'Analyze source-backed revenue/margins, balance-sheet health and cash flows. Separate observed history from predictions.',
  'technical-analyst': 'Interpret supplied RSI, MACD, Bollinger bands, moving averages, support/resistance and volume statistics; null indicators are unavailable. Note corporate-action/price-adjustment limitations.',
  'sentiment-analyst': 'Analyze only available news/document excerpts, themes and management tone; missing transcripts and social feeds remain unavailable.',
  'ratio-analyst': 'Interpret provided ratios and coherent financial facts; cite each material conclusion. Never mix currency or fiscal periods.',
  'quality-analyst': 'Interpret the financial-statement-analyzer metrics, active/suppressed signals and data quality. Do not recalculate or override deterministic values. Investigate cash conversion, non-recurring items, revenue recognition and accounting-policy differences using supplied documents. A signal is not proof of misconduct. Missing footnotes are a limitation.',
  'bull-agent': 'Construct the strongest evidence-supported bull thesis and catalysts, explicitly acknowledging missing inputs.',
  'bear-agent': 'Construct the strongest evidence-supported bear thesis, downside risks and thesis breakers.',
  'judge-agent': 'Evaluate both cases without averaging unsupported claims. Return balanced scorecard, conviction, swingFactors and limitations. Price targets must be copied from a supplied deterministic DCF or null.',
};

export function computedStatistics(foundation: Foundation,statement?:AgentOutput) {
  const f = foundation.facts; const divide = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null;
  const metrics=statement?.data.metrics as Array<Record<string,unknown>>|undefined;
  const period=metrics?.find(row=>row.date===foundation.fiscalDate);
  return { ratioBasis:period?'normalized_statement_tool':'ending_balance_fallback_requires_review',ratios: period ?? { operatingMargin: divide(f.operating_income, f.revenue), netMargin: divide(f.net_income, f.revenue), returnOnAssets: divide(f.net_income, f.total_assets), returnOnEquity: divide(f.net_income, f.total_equity), debtToEquity: divide(f.total_debt, f.total_equity), cashConversion: divide(f.operating_cash_flow, f.net_income) },
    technical: technicalIndicators(foundation.prices),
  };
}

export async function analysisAgent(name: string, foundation: Foundation, prior: Record<string, AgentOutput>,config?:EffectiveAgentConfig): Promise<AgentOutput> {
  const evidence=sourceEvidence(foundation);
  const citations = Object.keys(evidence);
  if (name === 'analysis-director') return evidenceOutput({ plan: Object.keys(roles) }, ['Parallel specialists share the same dated evidence, followed by opposing bull/bear cases and judge synthesis.'], citations, [], 60);
  if (!citations.length) return evidenceOutput({}, ['No attributable primary financial evidence or documents are available.'], [], ['Insufficient evidence for a defensible investment conclusion.'], 0);
  const market=inferResearchMarket(foundation.company);
  const output=await generateAgentOutput({ generalConfiguration: JSON.stringify({ ticker: foundation.company.ticker, market,providers:researchProviderPolicy[market],locale:foundation.researchLocale ?? foundation.researchPolicy?.locale ?? (market==='BR'?'pt-BR':'en'),currency: foundation.company.currency, fiscalDate: foundation.fiscalDate }),
    profiling: `${config?.protectedPolicy ?? rolePolicy(name)}\n${roles[name] ?? ''}`,
    perception: { facts: foundation.facts, statistics: computedStatistics(foundation,prior['financial-statement-analyzer']), financialStatementAnalysis:prior['financial-statement-analyzer'], marketStructure:prior['market-industry-research'], existingMarketBrief:foundation.marketBrief, documents: foundation.documents, sources: citations, prior:selectPrior(name,prior),thesis:foundation.thesisContext,holdings:foundation.holdings,
      observations:foundation.observations,evidenceAsOf:foundation.fiscalDate,ownerCustomization:config ? {objective:config.scope,outputEmphasis:config.promptAddendum} : null,
      sourceEvidence:evidence },
    action: `Return AgentOutput JSON. dataJson must encode findings (string array) and missingInputs (string array). ${name==='judge-agent' ? 'Completed judge output also requires investmentScore, thesisAlignmentScore, qualityScore, growthScore, riskScore (0–100), portfolioRole, keyCatalysts, keyRisks, evidencedThesisBreakers, monitoringTriggers, unresolvedDisagreements and swingFactors (string arrays). Do not average unsupported arguments; cite how specific disagreements are resolved.' : ''} Every material claim requires an allowed citation. Explain evidence, deterministic outputs and limitations concisely. Confidence reflects evidence quality, not future returns.`,
  }, citations,config);
  validateRoleData(name,output);
  if(name==='value-scorecard-analyst' && output.status==='completed') valueCriteriaSchema.parse(output.data.criteria);
  return output;
}
