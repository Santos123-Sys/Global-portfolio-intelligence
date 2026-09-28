import { z } from 'zod';
import { buildMarketPlan, MarketContext, type MarketIssue, MarketProfile } from './market-adaptive.js';

export const SourcedNumber = z.object({ value: z.number().finite(), asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), sourceRef: z.string().min(1) }).strict();
export type SourcedNumber = z.infer<typeof SourcedNumber>;
export const CapitalInputs = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/), cashFlowBasis: z.enum(['nominal', 'real']), riskFreeBasis: z.enum(['nominal', 'real']),
  riskFreeRate: SourcedNumber, expectedInflation: SourcedNumber.nullable(), matureErp: SourcedNumber, countryRiskPremium: SourcedNumber.nullable(),
  beta: SourcedNumber, taxRate: SourcedNumber, preTaxCostOfDebt: SourcedNumber, equityWeight: SourcedNumber,
  debtIncludesCountryRisk: z.boolean(), additionalDebtSpread: SourcedNumber.nullable(),
}).strict();
export type CapitalInputs = z.infer<typeof CapitalInputs>;
export const MarketValuationReview = z.object({ context: MarketContext, capital: CapitalInputs, profileSnapshot: z.array(MarketProfile).min(1).optional() }).strict();
export type MarketValuationReview = z.infer<typeof MarketValuationReview>;
function ageDays(date: string, now: Date) {
  const parsed = Date.parse(date);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) throw new Error('Invalid source date');
  return (Date.parse(now.toISOString().slice(0, 10)) - parsed) / 86_400_000;
}
export function validateMarketValuation(input: MarketValuationReview, valuationCurrency: string, now = new Date(), profiles?: MarketProfile[]): MarketIssue[] {
  const { context, capital: c } = MarketValuationReview.parse(input);
  const plan = buildMarketPlan(context, profiles); const issues = [...plan.issues];
  const issue = (code: string, detail: string) => issues.push({ code, severity: 'BLOCK', detail, sourceReferences: [] });
  if (context.reportingCurrency !== valuationCurrency || c.currency !== valuationCurrency) issue('currency_mismatch', 'Reporting currency, cash flows and cost of capital must share one currency; review translation separately.');
  const needsCrp = plan.nodes.some(n => n.id === 'CountryRiskAgent');
  if (needsCrp && c.countryRiskPremium == null) issue('missing_crp', 'A dated, sourced country-risk premium is required for the identified exposures. Zero must be explicitly justified and sourced.');
  if (plan.valuationMethod !== 'FCFF') issue('method_mismatch', 'Financial institutions require a reviewed FCFE/DDM or excess-return model; the standard FCFF screen cannot value this company.');
  if (c.cashFlowBasis === 'real' && c.riskFreeBasis === 'nominal') issue('rate_basis_mismatch', 'A nominal rate cannot discount real cash flows. Supply consistent real inputs.');
  if (c.cashFlowBasis === 'nominal' && c.riskFreeBasis === 'real' && !c.expectedInflation) issue('missing_inflation', 'Converting the real risk-free rate to nominal requires sourced expected inflation.');
  if (!c.debtIncludesCountryRisk && !c.additionalDebtSpread) issue('missing_debt_spread', 'Specify a sourced additional debt spread (including explicit zero) when debt yield excludes sovereign exposure.');
  if (c.debtIncludesCountryRisk && c.additionalDebtSpread && c.additionalDebtSpread.value !== 0) issue('double_counted_debt_risk', 'Debt yield already includes country risk; do not add another sovereign spread.');
  for (const [key, value] of Object.entries(c)) {
    if (!value || typeof value !== 'object' || !('asOf' in value)) continue;
    try {
      const age = ageDays(value.asOf, now);
      const maxAge = ['matureErp', 'countryRiskPremium'].includes(key) ? 366 : ['taxRate', 'beta', 'equityWeight'].includes(key) ? 366 : 31;
      if (age < 0 || age > maxAge) issue(`stale_${key}`, `${key} source date must be nonfuture and within ${maxAge} days; observed age ${age}.`);
    } catch { issue(`invalid_date_${key}`, `${key} has an invalid source date.`); }
  }
  for (const message of capitalRangeErrors(c)) issue(`range_${message.key}`, message.detail);
  return issues;
}
function capitalRangeErrors(c: CapitalInputs) {
  const ranges: Array<[string, number, number, number]> = [
    ['riskFreeRate', c.riskFreeRate.value, -.05, .5], ['matureErp', c.matureErp.value, 0, .5], ['beta', c.beta.value, 0, 10],
    ['taxRate', c.taxRate.value, 0, 1], ['preTaxCostOfDebt', c.preTaxCostOfDebt.value, 0, 1], ['equityWeight', c.equityWeight.value, 0, 1],
  ];
  if (c.countryRiskPremium) ranges.push(['countryRiskPremium', c.countryRiskPremium.value, 0, 1]);
  if (c.expectedInflation) ranges.push(['expectedInflation', c.expectedInflation.value, -.1, 1]);
  if (c.additionalDebtSpread) ranges.push(['additionalDebtSpread', c.additionalDebtSpread.value, 0, 1]);
  return ranges.filter(([, value, min, max]) => value < min || value > max).map(([key, , min, max]) => ({ key, detail: `${key} is outside the supported decimal range ${min}–${max}.` }));
}
export function computeCostOfCapital(input: CapitalInputs) {
  const c = CapitalInputs.parse(input);
  const rangeErrors = capitalRangeErrors(c);
  if (rangeErrors.length) throw new Error(rangeErrors.map(e => e.detail).join(' '));
  const rf = c.riskFreeBasis === c.cashFlowBasis ? c.riskFreeRate.value
    : c.riskFreeBasis === 'real' && c.expectedInflation ? (1 + c.riskFreeRate.value) * (1 + c.expectedInflation.value) - 1
    : NaN;
  if (!Number.isFinite(rf)) throw new Error('Risk-free rate and cash-flow basis cannot be reconciled');
  if (c.equityWeight.value < 0 || c.equityWeight.value > 1 || c.taxRate.value < 0 || c.taxRate.value > 1) throw new Error('Invalid tax rate or capital weights');
  if (c.debtIncludesCountryRisk && c.additionalDebtSpread && c.additionalDebtSpread.value !== 0) throw new Error('Country risk is double counted in debt');
  if (!c.debtIncludesCountryRisk && c.additionalDebtSpread == null) throw new Error('A sourced additional debt spread is required');
  const costOfEquity = rf + c.beta.value * c.matureErp.value + (c.countryRiskPremium?.value ?? 0);
  const afterTaxCostOfDebt = (c.preTaxCostOfDebt.value + (c.debtIncludesCountryRisk ? 0 : c.additionalDebtSpread!.value)) * (1 - c.taxRate.value);
  const wacc = c.equityWeight.value * costOfEquity + (1 - c.equityWeight.value) * afterTaxCostOfDebt;
  if (!Number.isFinite(wacc) || wacc <= 0 || wacc > .5) throw new Error('Computed WACC must be greater than zero and at most 50%');
  return { riskFreeRate: rf, costOfEquity, afterTaxCostOfDebt, wacc, currency: c.currency, basis: c.cashFlowBasis,
    methodology: 'Ke = default-free Rf + beta × mature ERP + explicit company-exposure CRP; WACC = E/V × Ke + D/V × sourced debt yield × (1 − tax).',
    sourceReferences: [...new Set(Object.values(c).flatMap(v => v && typeof v === 'object' && 'sourceRef' in v ? [v.sourceRef] : []))] };
}
export function countryRiskFromSpread(spread: SourcedNumber, relativeEquityBondVolatility: SourcedNumber, now = new Date()) {
  for (const value of [spread, relativeEquityBondVolatility]) {
    SourcedNumber.parse(value);
    const age = ageDays(value.asOf, now);
    if (age < 0 || age > 366) throw new Error('Country-risk source is stale or future dated');
  }
  if (spread.value < 0 || relativeEquityBondVolatility.value <= 0) throw new Error('Spread must be nonnegative and volatility ratio positive');
  const premium = spread.value * relativeEquityBondVolatility.value;
  if (!Number.isFinite(premium)) throw new Error('Nonfinite country-risk result');
  return { value: premium, asOf: spread.asOf < relativeEquityBondVolatility.asOf ? spread.asOf : relativeEquityBondVolatility.asOf,
    sourceRef: `${spread.sourceRef}; ${relativeEquityBondVolatility.sourceRef}`, methodology: 'Sovereign default spread × relative equity/bond volatility; no undated embedded rating table.' };
}
export function releverBeta(beta: number, oldDebtEquity: number, newDebtEquity: number, tax: number) {
  if (![beta, oldDebtEquity, newDebtEquity, tax].every(Number.isFinite) || beta < 0 || oldDebtEquity < 0 || newDebtEquity < 0 || tax < 0 || tax > 1) throw new Error('Invalid beta inputs');
  const unlevered = beta / (1 + (1 - tax) * oldDebtEquity);
  const relevered = unlevered * (1 + (1 - tax) * newDebtEquity);
  if (![unlevered, relevered].every(Number.isFinite)) throw new Error('Nonfinite beta result');
  return { unlevered, relevered, methodology: 'Hamada beta adjustment; assumes debt beta zero.' };
}
export const CashFlowValuationInput = z.object({
  method: z.enum(['FCFF', 'FCFE']), currency: z.string().regex(/^[A-Z]{3}$/), cashFlows: z.array(z.number().finite()).min(1).max(10),
  discountRate: z.number().positive().max(.5), terminalGrowth: z.number().min(-.05).max(.1), midYear: z.boolean(),
  netDebt: z.number().finite(), nonOperatingAssets: z.number().finite(), minorityAndPreferred: z.number().nonnegative(), shares: z.number().finite().positive(),
  terminalExit: z.object({ multiple: z.number().positive(), metric: z.number().positive(), kind: z.enum(['EV_EBITDA', 'P_E']) }).strict().nullable(),
  sourceReferences: z.array(z.string().min(1)).min(1),
}).strict();
export function valueCashFlows(raw: z.infer<typeof CashFlowValuationInput>) {
  const i = CashFlowValuationInput.parse(raw);
  if (i.discountRate <= i.terminalGrowth) throw new Error('Discount rate must exceed terminal growth');
  if (i.terminalExit && (i.method === 'FCFE') !== (i.terminalExit.kind === 'P_E')) throw new Error('Exit multiple is inconsistent with cash-flow method');
  const n = i.cashFlows.length;
  const pvExplicit = i.cashFlows.reduce((s, f, ix) => s + f / (1 + i.discountRate) ** (ix + 1 - (i.midYear ? .5 : 0)), 0);
  const terminalValue = i.cashFlows[n - 1] * (1 + i.terminalGrowth) / (i.discountRate - i.terminalGrowth);
  const pvTerminal = terminalValue / (1 + i.discountRate) ** n;
  const bridge = i.method === 'FCFF' ? -i.netDebt + i.nonOperatingAssets - i.minorityAndPreferred : 0;
  const equityValue = pvExplicit + pvTerminal + bridge;
  const exitEquityValue = i.terminalExit ? pvExplicit + i.terminalExit.multiple * i.terminalExit.metric / (1 + i.discountRate) ** n + bridge : null;
  const result = { pvExplicit, pvTerminal, terminalValue, enterpriseValue: i.method === 'FCFF' ? pvExplicit + pvTerminal : null, equityValue,
    valuePerShare: equityValue / i.shares, exitValuePerShare: exitEquityValue == null ? null : exitEquityValue / i.shares,
    terminalShare: pvExplicit + pvTerminal === 0 ? null : pvTerminal / (pvExplicit + pvTerminal), currency: i.currency,
    methodology: `${i.method}; ${i.midYear ? 'mid-year' : 'year-end'} explicit cash flows; end-of-year terminal value. FCFE has no enterprise-to-equity bridge.`, sourceReferences: i.sourceReferences };
  if (Object.values(result).some(v => typeof v === 'number' && !Number.isFinite(v))) throw new Error('Nonfinite valuation result');
  return result;
}
export function reconcileValuations(dcf: { currency: string; valuePerShare: number }, comps: { currency: string; valuePerShare: number }): MarketIssue[] {
  if (dcf.currency !== comps.currency) return [{ code: 'reconciliation_currency', severity: 'BLOCK', detail: 'DCF and peer values use different currencies and cannot be compared.', sourceReferences: [] }];
  if (![dcf.valuePerShare, comps.valuePerShare].every(Number.isFinite) || dcf.valuePerShare <= 0) return [{ code: 'reconciliation_unavailable', severity: 'WARN', detail: 'A positive finite DCF value is required to measure relative disagreement.', sourceReferences: [] }];
  const gap = Math.abs(dcf.valuePerShare - comps.valuePerShare) / dcf.valuePerShare;
  return gap > .35 ? [{ code: 'dcf_peer_gap', severity: 'WARN', detail: `DCF and peer values differ by ${(gap * 100).toFixed(1)}%. Retain both; review growth, margins and discount-rate scenarios.`, sourceReferences: [] }] : [];
}

/** Peer ratios are dimensionless; currencies are retained per issuer, never summed. */
export function screenMarketPeers<T extends { ticker: string; companyName: string; issuerId?: string; currency: string; financialPeriodEnd: string; sourceUrl: string }>(peers: T[]) {
  const seen = new Set<string>(); const accepted: T[] = []; const excluded: Array<{ ticker: string; reason: string }> = [];
  for (const peer of peers) {
    const identity = peer.issuerId?.trim().toUpperCase() || peer.companyName.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!identity || !peer.sourceUrl || !/^[A-Z]{3}$/.test(peer.currency)) { excluded.push({ ticker: peer.ticker, reason: 'Issuer identity, source or currency is unavailable.' }); continue; }
    const aliases = [identity, `ticker:${peer.ticker.trim().toUpperCase()}`, `name:${peer.companyName.toUpperCase().replace(/[^A-Z0-9]/g, '')}`];
    if (aliases.some(key => seen.has(key))) { excluded.push({ ticker: peer.ticker, reason: 'Same issuer already represented; ADR/share-class duplication.' }); continue; }
    aliases.forEach(key => seen.add(key)); accepted.push(peer);
  }
  return { accepted, excluded };
}
