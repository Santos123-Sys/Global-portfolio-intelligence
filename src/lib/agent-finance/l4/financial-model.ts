import { z } from 'zod';

export const capitalSchema = z.object({
  riskFreeRate: z.number().min(0).max(.5), beta: z.number().min(0).max(5),
  equityRiskPremium: z.number().min(0).max(.5), countryRiskPremium: z.number().min(0).max(.5),
  costOfDebt: z.number().min(0).max(.5), taxRate: z.number().min(0).max(1), debtWeight: z.number().min(0).max(1),
  sources: z.array(z.string().url()).min(1), currency: z.string().regex(/^[A-Z]{3}$/), asOf: z.string().date(),
}).strict();
export type CapitalInputs = z.infer<typeof capitalSchema>;
export function calculateWacc(input: CapitalInputs) {
  const p = capitalSchema.parse(input);
  const costOfEquity = p.riskFreeRate + p.beta * p.equityRiskPremium + p.countryRiskPremium;
  return { ...p, costOfEquity, afterTaxDebtCost: p.costOfDebt * (1 - p.taxRate),
    wacc: costOfEquity * (1 - p.debtWeight) + p.costOfDebt * (1 - p.taxRate) * p.debtWeight };
}

export const driverSchema = z.object({
  growth: z.number().min(-.5).max(.5), operatingMargin: z.number().min(-.5).max(.8),
  depreciationRatio: z.number().min(0).max(.5), capexRatio: z.number().min(0).max(1),
  workingCapitalRatio: z.number().min(-1).max(2), taxRate: z.number().min(0).max(1),
  debtRate: z.number().min(0).max(.5), payoutRatio: z.number().min(0).max(1).default(0),
  minimumCash: z.number().min(0).default(0),
}).strict();
export type Drivers = z.infer<typeof driverSchema>;
export const OPENING_FIELDS = ['revenue', 'operating_income', 'depreciation_and_amortization', 'capital_expenditure',
  'total_assets', 'total_equity', 'total_debt', 'cash_and_equivalents', 'non_cash_working_capital'] as const;

/** Retained earnings and cash are rolled through IS/CF; never balance the BS with an unexplained plug.
 * Fixed residual operating assets/liabilities are disclosed aggregates of the opening filing. */
export function projectStatements(facts: Record<string, number>, input: Drivers, years: number) {
  const d = driverSchema.parse(input);
  if (!Number.isInteger(years) || years < 5 || years > 10) throw new Error('Forecast requires 5–10 years');
  const missing = OPENING_FIELDS.filter(key => !Number.isFinite(facts[key]));
  if (missing.length) throw new Error(`Missing opening statement fields: ${missing.join(', ')}`);
  if (facts.revenue <= 0 || facts.total_assets <= 0 || facts.total_debt < 0 || facts.cash_and_equivalents < 0) throw new Error('Invalid opening balances');
  let revenue = facts.revenue, cash = facts.cash_and_equivalents, debt = facts.total_debt, equity = facts.total_equity;
  let workingCapital = facts.non_cash_working_capital;
  let operatingAssets = facts.total_assets - cash - workingCapital;
  const otherLiabilities = facts.total_assets - equity - debt;
  if (operatingAssets < 0 || otherLiabilities < 0) throw new Error('Opening assets/liabilities do not support the model');
  const rows = [];
  for (let year = 1; year <= years; year++) {
    const openingCash = cash, openingDebt = debt;
    revenue *= 1 + d.growth;
    const ebit = revenue * d.operatingMargin, depreciation = revenue * d.depreciationRatio;
    const interest = openingDebt * d.debtRate, pretax = ebit - interest;
    const taxes = Math.max(pretax, 0) * d.taxRate, netIncome = pretax - taxes;
    const nextWC = revenue * d.workingCapitalRatio, changeWC = nextWC - workingCapital;
    const capex = revenue * d.capexRatio, dividends = Math.max(netIncome, 0) * d.payoutRatio;
    const operatingCashFlow = netIncome + depreciation - changeWC;
    const investingCashFlow = -capex;
    const borrowing = Math.max(0, d.minimumCash - (cash + operatingCashFlow - capex - dividends));
    const financingCashFlow = borrowing - dividends;
    cash += operatingCashFlow + investingCashFlow + financingCashFlow;
    debt += borrowing; equity += netIncome - dividends;
    workingCapital = nextWC; operatingAssets += capex - depreciation;
    if (operatingAssets < 0) throw new Error(`Negative operating asset balance in year ${year}; review depreciation/capex`);
    const totalAssets = cash + workingCapital + operatingAssets;
    const totalLiabilities = debt + otherLiabilities;
    const balanceError = totalAssets - totalLiabilities - equity;
    const cashError = cash - openingCash - operatingCashFlow - investingCashFlow - financingCashFlow;
    if (Math.abs(balanceError) > Math.max(1, totalAssets) * 1e-9 || Math.abs(cashError) > Math.max(1, totalAssets) * 1e-9) throw new Error('Statement reconciliation failed');
    // EBIT-tax FCFF remains unlevered; financing cash flows do not enter enterprise valuation.
    const fcff = ebit * (1 - d.taxRate) + depreciation - capex - changeWC;
    rows.push({ year, incomeStatement: { revenue, ebitda: ebit + depreciation, depreciation, ebit, interest, pretax, taxes, netIncome },
      balanceSheet: { cash, nonCashWorkingCapital: workingCapital, operatingAssets, totalAssets, debt, otherLiabilities, totalLiabilities, equity },
      cashFlow: { openingCash, operatingCashFlow, investingCashFlow, financingCashFlow, capex, changeWC, dividends, borrowing, closingCash: cash, fcff },
      checks: { balanceError, cashError } });
  }
  return { drivers: d, projections: rows, accountingPolicy: 'Opening net operating assets and other liabilities are retained aggregates; incremental working capital scales with revenue. Debt draws maintain modeled minimum cash. Interest uses opening debt; tax shields on losses are not carried forward. No acquisitions, FX changes or buybacks modeled.' };
}
export type StatementModel = ReturnType<typeof projectStatements>;
export function valueProjection(model: StatementModel, wacc: number, terminalGrowth: number, netDebt: number, shares: number, exitMultiple?: number) {
  if (!(wacc > terminalGrowth && wacc <= .5 && terminalGrowth >= -.05 && terminalGrowth <= .05 && shares > 0)) throw new Error('Invalid valuation rates/shares');
  const last = model.projections.at(-1)!;
  const terminalValue = exitMultiple == null ? last.cashFlow.fcff * (1 + terminalGrowth) / (wacc - terminalGrowth) : last.incomeStatement.ebitda * exitMultiple;
  if (terminalValue <= 0 || (exitMultiple != null && (!(exitMultiple > 0) || exitMultiple > 100))) throw new Error('Terminal value requires positive normalized cash flow/EBITDA');
  const explicitPresentValue = model.projections.reduce((sum, row) => sum + row.cashFlow.fcff / (1 + wacc) ** row.year, 0);
  const terminalPresentValue = terminalValue / (1 + wacc) ** last.year;
  const enterpriseValue = explicitPresentValue + terminalPresentValue, equityValue = enterpriseValue - netDebt;
  return { method: exitMultiple == null ? 'perpetuity_growth' : 'exit_multiple', terminalValue, terminalPresentValue, enterpriseValue, equityValue,
    fairValuePerShare: equityValue / shares, impliedExitMultiple: last.incomeStatement.ebitda > 0 ? terminalValue / last.incomeStatement.ebitda : null,
    terminalShare: terminalPresentValue / enterpriseValue };
}

export const simulationSchema = z.object({
  samples: z.number().int().min(100).max(10000).default(1000), seed: z.number().int().min(1).max(2147483646).default(42),
  growthWidth: z.number().positive().max(.2), marginWidth: z.number().positive().max(.2), waccWidth: z.number().positive().max(.1),
  probabilities: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])
    .refine(p => Math.abs(p.reduce((a,b) => a+b,0)-1) < 1e-9, 'Scenario probabilities must sum to one'),
}).strict();
export type SimulationPolicy = z.infer<typeof simulationSchema>;
export function sensitivityAnalysis(facts: Record<string, number>, drivers: Drivers, years: number, wacc: number, g: number, netDebt: number, shares: number, policy?: SimulationPolicy) {
  const model = projectStatements(facts, drivers, years);
  const value = (d: Drivers, rate: number, growth: number) => valueProjection(projectStatements(facts, d, years), rate, growth, netDebt, shares).fairValuePerShare;
  const matrix = Array.from({ length: 7 }, (_, i) => wacc + (i-3)*.005).flatMap(discountRate => Array.from({ length: 7 }, (_, j) => {
    const terminalGrowthRate = g + (j-3)*.005;
    let fairValuePerShare: number | null = null;
    try { fairValuePerShare = valueProjection(model, discountRate, terminalGrowthRate, netDebt, shares).fairValuePerShare; } catch { /* invalid rate cell */ }
    return { discountRate, terminalGrowthRate, fairValuePerShare };
  }));
  const p = policy ? simulationSchema.parse(policy) : null;
  const growthWidth = p?.growthWidth ?? .02, marginWidth = p?.marginWidth ?? .01, waccWidth = p?.waccWidth ?? .01;
  const scenarios = [-1,0,1].map((sign, i) => ({ scenario: ['bear','base','bull'][i], probability: p?.probabilities[i] ?? null,
    fairValuePerShare: value({ ...drivers, growth: drivers.growth + sign*growthWidth, operatingMargin: drivers.operatingMargin + sign*marginWidth }, wacc-sign*waccWidth, g) }));
  const tornado = [
    { driver: 'Revenue growth', low: value({ ...drivers, growth: drivers.growth-growthWidth }, wacc,g), high: value({ ...drivers, growth: drivers.growth+growthWidth },wacc,g) },
    { driver: 'Operating margin', low: value({ ...drivers, operatingMargin: drivers.operatingMargin-marginWidth },wacc,g), high: value({ ...drivers, operatingMargin: drivers.operatingMargin+marginWidth },wacc,g) },
    { driver: 'WACC', low: value(drivers,wacc+waccWidth,g), high: value(drivers,wacc-waccWidth,g) },
  ].sort((a,b) => Math.abs(b.high-b.low)-Math.abs(a.high-a.low));
  if (!p) return { matrix, scenarios, tornado, probabilityWeightedValue: null, monteCarlo: null };
  let seed = p.seed;
  const random = () => { seed = seed * 16807 % 2147483647; return seed/2147483647; };
  // Symmetric triangular distributions, explicitly reviewed; independent drivers, not a calibrated probability forecast.
  const perturb = (width: number) => (random()+random()-1)*width;
  const values: number[] = []; let rejected = 0;
  for (let i=0;i<p.samples;i++) {
    try { const v = value({ ...drivers, growth: drivers.growth+perturb(p.growthWidth), operatingMargin: drivers.operatingMargin+perturb(p.marginWidth) },wacc+perturb(p.waccWidth),g); if (!Number.isFinite(v)) throw new Error('Nonfinite'); values.push(v); } catch { rejected++; }
  }
  if (rejected/p.samples > .2 || values.length === 0) throw new Error('More than 20% invalid simulations; narrow reviewed distributions');
  values.sort((a,b) => a-b);
  const quantile = (q: number) => values[Math.floor((values.length-1)*q)];
  const min = values[0], max = values.at(-1)!;
  const histogram = Array.from({ length: 20 }, (_,i) => ({ value: min+(max-min)*(i+.5)/20, count: 0 }));
  values.forEach(v => histogram[Math.min(19, Math.floor((v-min)/((max-min)||1)*20))].count++);
  return { matrix, scenarios, tornado, probabilityWeightedValue: scenarios.reduce((sum,row) => sum+row.fairValuePerShare*row.probability!,0),
    monteCarlo: { samples: p.samples, accepted: values.length, rejected, seed: p.seed, distribution: 'Independent symmetric triangular drivers; reviewed modeling policy', p5: quantile(.05), p50: quantile(.5), p95: quantile(.95), histogram } };
}
