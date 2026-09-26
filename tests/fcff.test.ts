import { describe, expect, it } from 'vitest';
import { deriveFcff } from '../src/lib/quant/fcff';

const facts = { operating_income: 200, depreciation_and_amortization: 20, capital_expenditure: 50, change_in_non_cash_working_capital: 20, income_tax_expense: 40, pre_tax_income: 200, operating_cash_flow: 142, interest_expense: 10 };
describe('auditable FCFF derivation', () => {
  it('reconciles EBIT and interest-adjusted CFO without double counting working capital', () => {
    expect(deriveFcff(facts).value).toBe(110);
    expect(deriveFcff(facts, { method: 'cfo', interestIncludedInCfo: true }).value).toBe(100);
    expect(deriveFcff({ ...facts, operating_cash_flow: 152 }, { method: 'cfo', interestIncludedInCfo: true }).value).toBe(110);
  });
  it('requires CFO interest classification and never substitutes generic FCF', () => {
    expect(deriveFcff(facts, { method: 'cfo' }).missingFields).toContain('confirmation_interest_is_included_in_operating_cash_flow');
    expect(deriveFcff({ free_cash_flow: 100 }).status).toBe('blocked');
  });
  it('requires missing working capital explicitly; accepts sourced zero or releases', () => {
    const withoutWc: Record<string, number> = { ...facts };
    delete withoutWc.change_in_non_cash_working_capital;
    expect(deriveFcff(withoutWc, { method: 'ebit' }).status).toBe('blocked');
    expect(deriveFcff(withoutWc, { method: 'ebit', workingCapitalInvestment: 0 }).value).toBe(130);
    expect(deriveFcff(withoutWc, { method: 'ebit', workingCapitalInvestment: -10 }).value).toBe(140);
  });
  it('does not clamp anomalous tax rates or assume taxes on losses', () => {
    expect(deriveFcff({ ...facts, pre_tax_income: -1 }).status).toBe('blocked');
    expect(deriveFcff({ ...facts, income_tax_expense: 300 }).status).toBe('blocked');
    expect(deriveFcff({ ...facts, pre_tax_income: -1 }, { taxRate: 0.25 }).value).toBe(100);
  });
  it('normalizes capex signs, rejects overflow, and preserves negative FCFF for suitability checks', () => {
    expect(deriveFcff({ ...facts, capital_expenditure: -50 }).value).toBe(110);
    expect(deriveFcff({ ...facts, operating_income: Number.MAX_VALUE, depreciation_and_amortization: Number.MAX_VALUE }).status).toBe('blocked');
    expect(deriveFcff({ ...facts, capital_expenditure: 500 }).value).toBe(-340);
  });
});
