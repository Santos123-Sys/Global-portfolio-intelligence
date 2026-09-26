import { FCFF_METRIC } from '../financial-evidence';

export const FCFF_INPUTS = [FCFF_METRIC, 'operating_income', 'depreciation_and_amortization', 'capital_expenditure',
  'change_in_non_cash_working_capital', 'operating_cash_flow', 'interest_expense', 'income_tax_expense', 'pre_tax_income'] as const;
export interface FcffPolicy {
  method?: 'auto' | 'ebit' | 'cfo';
  taxRate?: number;
  workingCapitalInvestment?: number;
  interestIncludedInCfo?: boolean;
}
export interface FcffDerivation {
  status: 'ready' | 'blocked'; method: 'reported' | 'ebit' | 'cfo' | null;
  value: number | null; formula: string; components: Record<string, number>;
  missingFields: string[]; caveats: string[];
}

/** CFA and Damodaran formulas. All financial numbers must come from one coherent filing. */
export function deriveFcff(facts: Record<string, number>, policy: FcffPolicy = {}): FcffDerivation {
  const usable = (name: string) => Number.isFinite(facts[name]) ? facts[name] : undefined;
  if (usable(FCFF_METRIC) != null && (!policy.method || policy.method === 'auto')) {
    return { status: 'ready', method: 'reported', value: facts[FCFF_METRIC], formula: 'Explicitly identified FCFF', components: { [FCFF_METRIC]: facts[FCFF_METRIC] }, missingFields: [], caveats: ['Review the issuer definition and any normalization adjustments.'] };
  }
  const pretax = usable('pre_tax_income');
  const taxExpense = usable('income_tax_expense');
  const effectiveTax = pretax != null && pretax > 0 && taxExpense != null ? taxExpense / pretax : undefined;
  const taxRate = policy.taxRate ?? effectiveTax;
  const validTax = taxRate != null && Number.isFinite(taxRate) && taxRate >= 0 && taxRate <= 1;
  const capex = usable('capital_expenditure');
  const workingCapital = policy.workingCapitalInvestment ?? usable('change_in_non_cash_working_capital');
  const ebitMissing = ['operating_income', 'depreciation_and_amortization'].filter(key => usable(key) == null);
  if (workingCapital == null || !Number.isFinite(workingCapital)) ebitMissing.push('change_in_non_cash_working_capital');
  const cfoMissing = ['operating_cash_flow', 'interest_expense'].filter(key => usable(key) == null);
  if (usable('interest_expense') != null && facts.interest_expense < 0) cfoMissing.push('nonnegative_interest_expense');
  if (!policy.interestIncludedInCfo) cfoMissing.push('confirmation_interest_is_included_in_operating_cash_flow');
  const method = policy.method === 'cfo' ? 'cfo' : policy.method === 'ebit' ? 'ebit' : ebitMissing.length === 0 ? 'ebit' : 'cfo';
  const missing = [...(method === 'ebit' ? ebitMissing : cfoMissing), ...(capex == null ? ['capital_expenditure'] : []), ...(!validTax ? ['valid_tax_rate'] : [])];
  const caveats = [
    policy.taxRate == null ? 'Tax uses reported income tax expense / positive pretax income: an effective-rate proxy, not a marginal-tax forecast.' : 'Tax rate is a reviewed modeling assumption; its rationale and source must be retained.',
    'Capital expenditure is normalized as a cash outflow. No second working-capital deduction is applied to CFO.',
    'Working-capital investment excludes cash and financing debt; positive means cash invested. Missing inputs never default to zero.',
  ];
  const formula = method === 'ebit' ? 'FCFF = EBIT × (1 − tax rate) + D&A − capex − non-cash working-capital investment'
    : 'FCFF = CFO + interest expense × (1 − tax rate) − capex';
  if (missing.length) return { status: 'blocked', method, value: null, formula, components: {}, missingFields: missing, caveats };
  const components: Record<string, number> = { tax_rate: taxRate!, capital_expenditure: Math.abs(capex!) };
  let value: number;
  if (method === 'ebit') {
    Object.assign(components, { operating_income: facts.operating_income, depreciation_and_amortization: facts.depreciation_and_amortization, change_in_non_cash_working_capital: workingCapital! });
    if (facts.depreciation_and_amortization < 0) return { status: 'blocked', method, value: null, formula, components, missingFields: ['nonnegative_depreciation_and_amortization'], caveats };
    value = facts.operating_income * (1 - taxRate!) + facts.depreciation_and_amortization - Math.abs(capex!) - workingCapital!;
  } else {
    Object.assign(components, { operating_cash_flow: facts.operating_cash_flow, interest_expense: facts.interest_expense });
    value = facts.operating_cash_flow + facts.interest_expense * (1 - taxRate!) - Math.abs(capex!);
    caveats.push('CFO method requires interest to be included in operating cash flow. Do not use this adjustment when interest is classified as financing.');
  }
  return Number.isFinite(value) ? { status: 'ready', method, value, formula, components, missingFields: [], caveats }
    : { status: 'blocked', method, value: null, formula, components, missingFields: ['finite_fcff_result'], caveats };
}
