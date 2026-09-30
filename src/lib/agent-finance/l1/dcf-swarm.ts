import { deriveFcff } from '@/lib/quant/fcff';
import { discountedCashFlow, type DcfAssumptions } from '@/lib/quant/dcf';
import { evidenceOutput, type AnalyzeRequest, type AgentOutput } from '../contracts';
import type { Foundation } from '../l4/foundation';

export interface DcfContext { request: AnalyzeRequest; foundation: Foundation; outputs: Record<string, AgentOutput> }

/** Never let an agent invent WACC or translate generic free cash flow into unlevered FCFF. */
export function buildAssumptions(context: DcfContext): { input: DcfAssumptions | null; missing: string[] } {
  const { request, foundation } = context; const overrides = request.userOverrides; const a = overrides?.assumptions;
  const derived = deriveFcff(foundation.facts, { method: 'ebit', taxRate: a?.taxRate });
  const netDebt = a?.netDebt ?? (Number.isFinite(foundation.facts.total_debt) && Number.isFinite(foundation.facts.cash_and_equivalents) ? foundation.facts.total_debt - foundation.facts.cash_and_equivalents : undefined);
  const shares = a?.sharesOutstanding ?? foundation.facts.shares_outstanding;
  const missing = [...derived.missingFields];
  if (derived.value == null || derived.value <= 0) missing.push('positive_source_backed_fcff');
  if (a?.annualGrowthRate == null) missing.push('reviewed_annual_growth_rate');
  if (a?.terminalGrowthRate == null) missing.push('reviewed_terminal_growth_rate');
  if (overrides?.discountRate == null) missing.push('reviewed_wacc');
  if (netDebt == null || !Number.isFinite(netDebt)) missing.push('net_debt');
  if (shares == null || !Number.isFinite(shares) || shares <= 0) missing.push('positive_shares_outstanding');
  if (!foundation.fiscalDate || !foundation.sources.length) missing.push('coherent_primary_filing');
  if (missing.length) return { input: null, missing: [...new Set(missing)] };
  return { input: { currency: foundation.company.currency, startingFreeCashFlow: derived.value!, forecastYears: overrides?.timeHorizon ?? 5,
    annualGrowthRate: a!.annualGrowthRate!, discountRate: overrides!.discountRate!, terminalGrowthRate: a!.terminalGrowthRate!,
    netDebt: netDebt!, sharesOutstanding: shares!, dataAsOf: `${foundation.fiscalDate}T00:00:00Z`, sourceReferences: foundation.sources }, missing: [] };
}

export async function dcfAgent(name: string, context: DcfContext, compute: (input: DcfAssumptions) => Promise<unknown>): Promise<AgentOutput> {
  const { foundation } = context;
  if (name === 'dcf-orchestrator') return evidenceOutput({ workflow: ['assumptions', 'growth', 'projection', 'wacc', 'terminal', 'sensitivity', 'sanity'] }, ['Validate coherent filing evidence before numerical valuation.'], foundation.sources, [], 60);
  const built = buildAssumptions(context);
  if (!built.input) return { ...evidenceOutput({ missingInputs: built.missing }, ['No valuation is calculated because required evidence or reviewed assumptions are absent.'], foundation.sources, built.missing, 0), status: 'blocked' };
  const input = built.input;
  if (name === 'assumption-setter') return evidenceOutput({ assumptions: input }, ['FCFF uses one coherent primary filing; growth, WACC and terminal growth are explicit user modeling overrides.'], input.sourceReferences, ['Forecast assumptions require human review.'], 65);
  if (name === 'growth-modeler') return evidenceOutput({ fcffForecast: Array.from({ length: input.forecastYears }, (_, i) => ({ year: i + 1, fcff: input.startingFreeCashFlow * (1 + input.annualGrowthRate) ** (i + 1) })) }, ['Apply reviewed growth geometrically to source-backed FCFF.'], input.sourceReferences, ['Constant-growth FCFF forecast; segment revenue/TAM evidence is not available.'], 65);
  if (name === 'projection-builder') return evidenceOutput({ fcffDerivation: deriveFcff(foundation.facts, { method: 'ebit', taxRate: context.request.userOverrides?.assumptions?.taxRate }), forecastYears: input.forecastYears }, ['FCFF = EBIT × (1 − tax) + D&A − capex − non-cash working-capital investment.'], input.sourceReferences, ['A fully reconciled three-statement forecast requires additional opening balances and financing policies.'], 65);
  if (name === 'wacc-calculator') return evidenceOutput({ wacc: input.discountRate, origin: 'user_reviewed_override' }, ['Use the explicitly supplied discount rate; do not infer a risk-free rate or capital structure.'], input.sourceReferences, ['CAPM build-up cannot be independently evidenced without risk-free rate, beta, premium and debt-cost inputs.'], 60);
  const result = await compute(input) as ReturnType<typeof discountedCashFlow>;
  if (name === 'terminal-value') return evidenceOutput({ terminalValue: result.terminalValue, enterpriseValue: result.enterpriseValue, equityValue: result.equityValue, fairValuePerShare: result.fairValuePerShare, currency: result.currency }, ['Gordon terminal value = final FCFF × (1 + g) / (WACC − g).', 'Discount terminal value and explicit flows; subtract net debt and divide by shares.'], input.sourceReferences, ['Exit multiple requires verified peer evidence; only perpetual-growth terminal value is computed.'], 65);
  if (name === 'sensitivity-analyst') {
    const matrix = Array.from({ length: 7 }, (_, i) => input.discountRate + (i - 3) * .005).flatMap(discountRate =>
      Array.from({ length: 7 }, (_, j) => input.terminalGrowthRate + (j - 3) * .005).map(terminalGrowthRate => {
        const valid = discountRate > 0 && discountRate <= .5 && terminalGrowthRate >= -.05 && terminalGrowthRate <= .05 && discountRate > terminalGrowthRate;
        return { discountRate, terminalGrowthRate, fairValuePerShare: valid ? discountedCashFlow({ ...input, discountRate, terminalGrowthRate }).fairValuePerShare : null };
      }));
    const scenarios = [-.02, 0, .02].map((delta, i) => ({ scenario: ['bear', 'base', 'bull'][i], ...discountedCashFlow({ ...input, annualGrowthRate: Math.max(-.5, Math.min(.5, input.annualGrowthRate + delta)) }) }));
    return evidenceOutput({ matrix, scenarios }, ['Reprice 49 WACC/terminal-growth combinations; invalid WACC ≤ g cells stay null.', 'Scenario growth perturbations are illustrative, not statistically estimated probabilities.'], input.sourceReferences, ['Monte Carlo and probability-weighted values require reviewed distribution assumptions.'], 60);
  }
  const market = foundation.prices.at(-1)?.close;
  const deviation = market && market > 0 ? Math.abs(result.fairValuePerShare / market - 1) : null;
  return evidenceOutput({ model: result, requiresHumanReview: true, extremeDeviation: deviation != null && deviation > .5 }, ['Check WACC > terminal growth, positive shares, finite results, and market-price deviation.', 'All modeled valuations remain review-gated; this creates no portfolio position or order.'], input.sourceReferences, result.caveats, 65);
}
