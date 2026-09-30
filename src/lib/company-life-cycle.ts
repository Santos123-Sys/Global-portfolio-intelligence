export const COMPANY_LIFE_CYCLE_STAGES = ['start_up', 'growth', 'maturity', 'diversification', 'decline'] as const;
export type CompanyLifeCycleStage = typeof COMPANY_LIFE_CYCLE_STAGES[number];

export interface LifeCyclePeriod {
  periodEnd: string;
  metrics: Record<string, number>;
  revenueGrowth: number | null;
}

export interface LifeCycleAssessment {
  suggestedStage: CompanyLifeCycleStage | null;
  confidence: 'low' | 'medium';
  rationale: string;
  evidence: string[];
  limitations: string[];
}

export interface LifeCyclePolicy {
  stage: CompanyLifeCycleStage;
  label: string;
  standardFcffDcfAllowed: boolean;
  valuationFocus: string[];
  terminalValueGuidance: string;
  transitionGuidance: string;
}

const finite = (value: number | undefined): number | null =>
  value != null && Number.isFinite(value) ? value : null;

export function lifeCyclePolicy(stage: CompanyLifeCycleStage): LifeCyclePolicy {
  switch (stage) {
    case 'start_up':
      return {
        stage,
        label: 'Start-up',
        standardFcffDcfAllowed: false,
        valuationFocus: [
          'Cross-check top-down market sizing with a bottom-up operating case.',
          'Use non-financial operating metrics where they are demonstrably predictive of future cash flow.',
          'Model failure/mortality risk and key-person dependence explicitly before relying on a going-concern DCF.',
        ],
        terminalValueGuidance: 'Do not rely on an unadjusted perpetual-growth terminal value while failure risk is material.',
        transitionGuidance: 'Treat movement into young growth as uncertain; stage transitions are not assumed to be linear or sequential.',
      };
    case 'growth':
      return {
        stage,
        label: 'Growth',
        standardFcffDcfAllowed: true,
        valuationFocus: [
          'Separate cash flow from assets already in place from cash flow created by new investment.',
          'Test whether historical revenue growth, margins and reinvestment are sustainable against sector evidence and scale effects.',
          'Explicitly model the fade from high growth to stable growth rather than carrying current growth indefinitely.',
        ],
        terminalValueGuidance: 'Stable growth should be materially lower than the high-growth phase and consistent with stable-company economics, reinvestment and cost of capital.',
        transitionGuidance: 'A move toward maturity is expected eventually, but timing must be justified rather than assumed.',
      };
    case 'maturity':
      return {
        stage,
        label: 'Maturity',
        standardFcffDcfAllowed: true,
        valuationFocus: [
          'Prioritize assets in place, operating efficiency and accounting-quality normalization.',
          'Separate organic growth from acquisition-driven growth and test the historical economics of acquisitions.',
          'Review working-capital and maintenance-capex needs rather than assuming recent reported earnings equal sustainable cash flow.',
        ],
        terminalValueGuidance: 'Terminal value is usually important; use a stable growth rate and a reinvestment rate consistent with the return on capital achievable in steady state.',
        transitionGuidance: 'A mature firm may reaccelerate through diversification or regress; do not force a one-way life-cycle path.',
      };
    case 'diversification':
      return {
        stage,
        label: 'Diversification',
        standardFcffDcfAllowed: true,
        valuationFocus: [
          'Keep the mature core and diversification initiatives analytically separate.',
          'Distinguish organic expansion from acquisitions and assess the economics, timing and execution risk of each initiative.',
          'Use scenario or real-options reasoning for material expansion choices whose timing is genuinely discretionary.',
        ],
        terminalValueGuidance: 'Base terminal economics on the sustainable mature business, not on temporary option value or one-off acquisition bursts.',
        transitionGuidance: 'Diversification can reaccelerate growth after maturity, but successful reacceleration must be evidenced rather than presumed.',
      };
    case 'decline':
      return {
        stage,
        label: 'Decline',
        standardFcffDcfAllowed: false,
        valuationFocus: [
          'Assess whether decline is reversible, whether invested capital earns below the cost of capital, and whether assets should be divested.',
          'Model distress probability, liquidation proceeds and discontinuities in cash flow explicitly.',
          'Distinguish a shrinking going concern from orderly or forced liquidation.',
        ],
        terminalValueGuidance: 'Do not use a standard perpetual-growth residual value as the default. Use a distress-adjusted going-concern/liquidation framework instead.',
        transitionGuidance: 'Recovery is possible, but the valuation must price the probability and economics of that transition rather than assume it.',
      };
  }
}

/**
 * A deliberately conservative, provisional assessment from retained annual financials.
 * It is a review aid, never an automatic classification. Diversification is not inferred
 * from aggregate statements because it requires evidence about product/market expansion,
 * acquisitions or strategic scope.
 */
export function assessCompanyLifeCycle(periods: LifeCyclePeriod[]): LifeCycleAssessment {
  const ordered = [...periods].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).slice(-5);
  const evidence: string[] = [];
  const limitations = [
    'Life-cycle stages are analytical states, not hard empirical facts; companies can skip stages or move backward.',
    'Diversification cannot be inferred reliably from aggregate annual financial statements alone.',
  ];
  if (ordered.length < 2) {
    return {
      suggestedStage: null,
      confidence: 'low',
      rationale: 'At least two comparable annual periods are needed for a provisional financial-pattern assessment.',
      evidence,
      limitations,
    };
  }

  const growthRates = ordered.map(p => p.revenueGrowth).filter((v): v is number => v != null && Number.isFinite(v));
  const latest = ordered[ordered.length - 1]!;
  const latestGrowth = latest.revenueGrowth;
  const averageGrowth = growthRates.length ? growthRates.reduce((a, b) => a + b, 0) / growthRates.length : null;
  const latestOperatingIncome = finite(latest.metrics.operating_income);
  const latestOperatingCashFlow = finite(latest.metrics.operating_cash_flow);
  const latestFcf = finite(latest.metrics.free_cash_flow);

  if (latestGrowth != null) evidence.push(`Latest revenue growth: ${(latestGrowth * 100).toFixed(1)}%.`);
  if (averageGrowth != null) evidence.push(`Average observed revenue growth: ${(averageGrowth * 100).toFixed(1)}% across comparable periods.`);
  if (latestOperatingIncome != null) evidence.push(`Latest operating income is ${latestOperatingIncome >= 0 ? 'positive' : 'negative'}.`);
  if (latestOperatingCashFlow != null) evidence.push(`Latest operating cash flow is ${latestOperatingCashFlow >= 0 ? 'positive' : 'negative'}.`);
  if (latestFcf != null) evidence.push(`Latest reported free cash flow is ${latestFcf >= 0 ? 'positive' : 'negative'}.`);

  if ((latestGrowth != null && latestGrowth < -0.05) || (averageGrowth != null && averageGrowth < -0.03)) {
    return {
      suggestedStage: 'decline',
      confidence: growthRates.length >= 3 ? 'medium' : 'low',
      rationale: 'The retained annual history shows contracting revenue, which is consistent with a decline-state warning. Distress and reversibility still require separate evidence.',
      evidence,
      limitations,
    };
  }
  if (averageGrowth != null && averageGrowth >= 0.10 && (latestOperatingIncome == null || latestOperatingIncome >= 0)) {
    return {
      suggestedStage: 'growth',
      confidence: growthRates.length >= 3 ? 'medium' : 'low',
      rationale: 'The retained annual history shows rapid positive revenue growth with no clear operating-loss signal in the latest period.',
      evidence,
      limitations,
    };
  }
  if ((latestOperatingIncome != null && latestOperatingIncome < 0) && (latestOperatingCashFlow != null && latestOperatingCashFlow < 0) && ordered.length <= 3) {
    return {
      suggestedStage: 'start_up',
      confidence: 'low',
      rationale: 'Limited operating history combined with negative operating earnings and cash flow is consistent with a start-up/young-growth pattern, but age, funding and market evidence are still required.',
      evidence,
      limitations,
    };
  }
  if (averageGrowth != null && averageGrowth > -0.03 && averageGrowth < 0.10 && (latestOperatingIncome == null || latestOperatingIncome >= 0)) {
    return {
      suggestedStage: 'maturity',
      confidence: growthRates.length >= 3 ? 'medium' : 'low',
      rationale: 'The retained annual history shows slower revenue growth with non-negative latest operating income, which is consistent with a mature operating profile.',
      evidence,
      limitations,
    };
  }

  return {
    suggestedStage: null,
    confidence: 'low',
    rationale: 'The available financial pattern does not support a sufficiently clear provisional stage. Use qualitative operating evidence and management disclosures.',
    evidence,
    limitations,
  };
}
