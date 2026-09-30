import { evidenceOutput, type AgentOutput } from '../contracts';
import { generateAgentOutput } from '../l2/model-router';
import type { Foundation } from '../l4/foundation';

const roles: Record<string, string> = {
  'fundamental-analyst': 'Analyze source-backed revenue/margins, balance-sheet health and cash flows. Separate observed history from predictions.',
  'technical-analyst': 'Interpret the supplied computed price statistics; do not invent RSI, MACD or volumes not present.',
  'sentiment-analyst': 'Analyze only available news/document excerpts, themes and management tone; missing transcripts and social feeds remain unavailable.',
  'ratio-analyst': 'Interpret provided ratios and coherent financial facts; cite each material conclusion. Never mix currency or fiscal periods.',
  'quality-analyst': 'Assess cash conversion and accrual risks from supplied financial facts; absence of footnotes is a material limitation.',
  'bull-agent': 'Construct the strongest evidence-supported bull thesis and catalysts, explicitly acknowledging missing inputs.',
  'bear-agent': 'Construct the strongest evidence-supported bear thesis, downside risks and thesis breakers.',
  'judge-agent': 'Evaluate both cases without averaging unsupported claims. Return balanced scorecard, conviction, swingFactors and limitations. Price targets must be copied from a supplied deterministic DCF or null.',
};

export function computedStatistics(foundation: Foundation) {
  const f = foundation.facts; const divide = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b : null;
  const prices = foundation.prices.map(row => row.close).filter(value => Number.isFinite(value) && value > 0);
  const sma = (n: number) => prices.length >= n ? prices.slice(-n).reduce((sum, value) => sum + value, 0) / n : null;
  return { ratios: { operatingMargin: divide(f.operating_income, f.revenue), netMargin: divide(f.net_income, f.revenue), returnOnAssets: divide(f.net_income, f.total_assets), returnOnEquity: divide(f.net_income, f.total_equity), debtToEquity: divide(f.total_debt, f.total_equity), cashConversion: divide(f.operating_cash_flow, f.net_income) },
    technical: { observations: prices.length, latestPrice: prices.at(-1) ?? null, sma20: sma(20), sma50: sma(50), sma200: sma(200), support: prices.length ? Math.min(...prices.slice(-60)) : null, resistance: prices.length ? Math.max(...prices.slice(-60)) : null },
  };
}

export async function analysisAgent(name: string, foundation: Foundation, prior: Record<string, AgentOutput>): Promise<AgentOutput> {
  const citations = [...new Set([...foundation.sources, ...foundation.documents.map(row => row.source)])];
  if (name === 'analysis-director') return evidenceOutput({ plan: Object.keys(roles) }, ['Parallel specialists share the same dated evidence, followed by opposing bull/bear cases and judge synthesis.'], citations, [], 60);
  if (!citations.length) return evidenceOutput({}, ['No attributable primary financial evidence or documents are available.'], [], ['Insufficient evidence for a defensible investment conclusion.'], 0);
  return generateAgentOutput({ generalConfiguration: JSON.stringify({ ticker: foundation.company.ticker, currency: foundation.company.currency, fiscalDate: foundation.fiscalDate }),
    profiling: roles[name] ?? 'Synthesize source-backed research without taking investment action.',
    perception: { facts: foundation.facts, statistics: computedStatistics(foundation), documents: foundation.documents, sources: citations, prior },
    action: 'Return AgentOutput JSON. Every material claim requires an allowed citation. Explain the key evidence, formula outputs and limitations concisely. Confidence reflects evidence quality, not certainty of future returns.',
  }, citations);
}
