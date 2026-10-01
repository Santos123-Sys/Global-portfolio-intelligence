import { evidenceOutput, validateRoleData, type AgentOutput } from '../contracts';
import { generateAgentOutput } from '../l2/model-router';
import {sourceEvidence, type Foundation } from '../l4/foundation';
import { technicalIndicators } from '../l4/technical';
import { rolePolicy } from '@portfolio-intelligence/agentic-contract';
import { selectPrior, type EffectiveAgentConfig } from '@/lib/agent-governance';

const roles: Record<string, string> = {
  'fundamental-analyst': 'Analyze source-backed revenue/margins, balance-sheet health and cash flows. Separate observed history from predictions.',
  'technical-analyst': 'Interpret supplied RSI, MACD, Bollinger bands, moving averages, support/resistance and volume statistics; null indicators are unavailable. Note corporate-action/price-adjustment limitations.',
  'sentiment-analyst': 'Analyze only available news/document excerpts, themes and management tone; missing transcripts and social feeds remain unavailable.',
  'ratio-analyst': 'Interpret provided ratios and coherent financial facts; cite each material conclusion. Never mix currency or fiscal periods.',
  'quality-analyst': 'Assess cash conversion and accrual risks from supplied financial facts; absence of footnotes is a material limitation.',
  'bull-agent': 'Construct the strongest evidence-supported bull thesis and catalysts, explicitly acknowledging missing inputs.',
  'bear-agent': 'Construct the strongest evidence-supported bear thesis, downside risks and thesis breakers.',
  'judge-agent': 'Evaluate both cases without averaging unsupported claims. Return balanced scorecard, conviction, swingFactors and limitations. Price targets must be copied from a supplied deterministic DCF or null.',
};

export function computedStatistics(foundation: Foundation) {
  const f = foundation.facts; const divide = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b : null;
  return { ratios: { operatingMargin: divide(f.operating_income, f.revenue), netMargin: divide(f.net_income, f.revenue), returnOnAssets: divide(f.net_income, f.total_assets), returnOnEquity: divide(f.net_income, f.total_equity), debtToEquity: divide(f.total_debt, f.total_equity), cashConversion: divide(f.operating_cash_flow, f.net_income) },
    technical: technicalIndicators(foundation.prices),
  };
}

export async function analysisAgent(name: string, foundation: Foundation, prior: Record<string, AgentOutput>,config?:EffectiveAgentConfig): Promise<AgentOutput> {
  const evidence=sourceEvidence(foundation);
  const citations = Object.keys(evidence);
  if (name === 'analysis-director') return evidenceOutput({ plan: Object.keys(roles) }, ['Parallel specialists share the same dated evidence, followed by opposing bull/bear cases and judge synthesis.'], citations, [], 60);
  if (!citations.length) return evidenceOutput({}, ['No attributable primary financial evidence or documents are available.'], [], ['Insufficient evidence for a defensible investment conclusion.'], 0);
  const output=await generateAgentOutput({ generalConfiguration: JSON.stringify({ ticker: foundation.company.ticker, currency: foundation.company.currency, fiscalDate: foundation.fiscalDate }),
    profiling: config?.protectedPolicy ?? rolePolicy(name),
    perception: { facts: foundation.facts, statistics: computedStatistics(foundation), documents: foundation.documents, sources: citations, prior:selectPrior(name,prior),thesis:foundation.thesisContext,holdings:foundation.holdings,
      observations:foundation.observations,evidenceAsOf:foundation.fiscalDate,ownerCustomization:config ? {objective:config.scope,outputEmphasis:config.promptAddendum} : null,
      sourceEvidence:evidence },
    action: `Return AgentOutput JSON. dataJson must encode findings (string array) and missingInputs (string array). ${name==='judge-agent' ? 'Completed judge output also requires investmentScore, thesisAlignmentScore, qualityScore, growthScore, riskScore (0–100), portfolioRole, keyCatalysts, keyRisks, evidencedThesisBreakers, monitoringTriggers, unresolvedDisagreements and swingFactors (string arrays). Do not average unsupported arguments; cite how specific disagreements are resolved.' : ''} Every material claim requires an allowed citation. Explain evidence, deterministic outputs and limitations concisely. Confidence reflects evidence quality, not future returns.`,
  }, citations,config);
  return validateRoleData(name,output);
}
