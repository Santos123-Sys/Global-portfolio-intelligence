import { describe, expect, it } from 'vitest';
import { assessCompanyLifeCycle, lifeCyclePolicy } from '../src/lib/company-life-cycle';

describe('company life-cycle valuation policy', () => {
  it('treats start-up and decline as requiring stage-specific alternatives to a standard perpetual FCFF DCF', () => {
    expect(lifeCyclePolicy('start_up').standardFcffDcfAllowed).toBe(false);
    expect(lifeCyclePolicy('decline').standardFcffDcfAllowed).toBe(false);
    expect(lifeCyclePolicy('growth').standardFcffDcfAllowed).toBe(true);
    expect(lifeCyclePolicy('maturity').standardFcffDcfAllowed).toBe(true);
    expect(lifeCyclePolicy('diversification').standardFcffDcfAllowed).toBe(true);
  });

  it('suggests growth from sustained rapid positive revenue growth', () => {
    const result = assessCompanyLifeCycle([
      { periodEnd: '2023-12-31', metrics: { operating_income: 10 }, revenueGrowth: null },
      { periodEnd: '2024-12-31', metrics: { operating_income: 20 }, revenueGrowth: .18 },
      { periodEnd: '2025-12-31', metrics: { operating_income: 30 }, revenueGrowth: .14 },
    ]);
    expect(result.suggestedStage).toBe('growth');
    expect(result.confidence).toBe('low');
  });

  it('flags decline from contracting revenue and never infers diversification from aggregate statements', () => {
    const decline = assessCompanyLifeCycle([
      { periodEnd: '2023-12-31', metrics: { operating_income: 20 }, revenueGrowth: null },
      { periodEnd: '2024-12-31', metrics: { operating_income: 15 }, revenueGrowth: -.06 },
      { periodEnd: '2025-12-31', metrics: { operating_income: 5 }, revenueGrowth: -.08 },
    ]);
    expect(decline.suggestedStage).toBe('decline');
    expect(decline.limitations.join(' ')).toContain('Diversification');
  });
});
