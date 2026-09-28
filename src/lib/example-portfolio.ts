import { deriveFcff } from './quant/fcff';
import { threeCaseDiscountedCashFlow } from './quant/dcf';

/** Entirely fictional teaching case. Values are CHF millions, not issuer facts. */
const rows = [
  { ticker: 'DEMO-ALP', name: 'Alpen Health AG', sector: 'Health care', startingWeight: 0.25,
    thesisFit: 'Recurring clinical-supply demand and diversified customers.', researchRisk: 'A large distributor could pressure pricing.',
    revenuePrior: 1200, revenue: 1320, ebit: 198, depreciation: 46, capex: 80, workingCapital: 12, taxRate: 0.22,
    dcfGrowth: 0.045, discountRate: 0.095, netDebt: 180, sharesOutstanding: 60 },
  { ticker: 'DEMO-LIM', name: 'Limmat Automation AG', sector: 'Industrials', startingWeight: 0.20,
    thesisFit: 'Service contracts complement industrial equipment sales.', researchRisk: 'Capital-spending cycles may delay orders.',
    revenuePrior: 920, revenue: 984, ebit: 138, depreciation: 39, capex: 58, workingCapital: 15, taxRate: 0.22,
    dcfGrowth: 0.04, discountRate: 0.10, netDebt: 90, sharesOutstanding: 45 },
  { ticker: 'DEMO-CED', name: 'Cedar Foods AG', sector: 'Consumer staples', startingWeight: 0.18,
    thesisFit: 'Repeat purchases provide a defensive demand scenario.', researchRisk: 'Input costs could erode margins.',
    revenuePrior: 850, revenue: 901, ebit: 108, depreciation: 29, capex: 43, workingCapital: 8, taxRate: 0.22,
    dcfGrowth: 0.035, discountRate: 0.09, netDebt: 40, sharesOutstanding: 40 },
  { ticker: 'DEMO-RIG', name: 'Rigi Software AG', sector: 'Technology', startingWeight: 0.15,
    thesisFit: 'Subscription renewals support an illustrative growth case.', researchRisk: 'Customer churn and competition could reduce growth.',
    revenuePrior: 520, revenue: 624, ebit: 94, depreciation: 18, capex: 30, workingCapital: 11, taxRate: 0.22,
    dcfGrowth: 0.08, discountRate: 0.11, netDebt: 25, sharesOutstanding: 30 },
  { ticker: 'DEMO-AAR', name: 'Aare Utilities AG', sector: 'Utilities', startingWeight: 0.12,
    thesisFit: 'Contracted revenue provides an illustrative stability case.', researchRisk: 'Heavy reinvestment can constrain free cash flow.',
    revenuePrior: 1100, revenue: 1144, ebit: 160, depreciation: 70, capex: 145, workingCapital: 6, taxRate: 0.22,
    dcfGrowth: 0.025, discountRate: 0.08, netDebt: 350, sharesOutstanding: 75 },
  { ticker: 'DEMO-TIC', name: 'Ticino Logistics AG', sector: 'Transport', startingWeight: 0.10,
    thesisFit: 'A diversified customer mix gives a logistics comparison.', researchRisk: 'Fuel and wage costs could compress margins.',
    revenuePrior: 730, revenue: 781, ebit: 78, depreciation: 33, capex: 48, workingCapital: 10, taxRate: 0.22,
    dcfGrowth: 0.04, discountRate: 0.105, netDebt: 55, sharesOutstanding: 35 },
] as const;

export const examplePortfolio = {
  name: 'Illustrative Swiss Quality portfolio', currency: 'CHF', scenarioVersion: '2026-09-28',
  mandate: 'Explore six fictional Swiss companies across distinct sectors. Long-only, fully invested, maximum 50% per asset.',
  researchDisclosure: 'All issuers, identifiers, thesis observations and financial inputs are invented for this teaching case. No filings, quotes or primary sources were retrieved.',
  assets: rows.map(row => {
    const fcff = deriveFcff({ operating_income: row.ebit, depreciation_and_amortization: row.depreciation,
      capital_expenditure: row.capex, change_in_non_cash_working_capital: row.workingCapital },
    { method: 'ebit', taxRate: row.taxRate });
    if (fcff.status !== 'ready') throw new Error('Example financial inputs are incomplete');
    const dcf = threeCaseDiscountedCashFlow({
      worst_case: { currency: 'CHF', startingFreeCashFlow: fcff.value!, forecastYears: 5,
        annualGrowthRate: row.dcfGrowth - 0.03, discountRate: row.discountRate + 0.02,
        terminalGrowthRate: 0.01, netDebt: row.netDebt, sharesOutstanding: row.sharesOutstanding,
        dataAsOf: '2026-09-28T00:00:00.000Z', sourceReferences: [`synthetic-example:${row.ticker}:fictional-inputs`] },
      base_case: { currency: 'CHF', startingFreeCashFlow: fcff.value!, forecastYears: 5,
        annualGrowthRate: row.dcfGrowth, discountRate: row.discountRate,
        terminalGrowthRate: 0.02, netDebt: row.netDebt, sharesOutstanding: row.sharesOutstanding,
        dataAsOf: '2026-09-28T00:00:00.000Z', sourceReferences: [`synthetic-example:${row.ticker}:fictional-inputs`] },
      optimistic_case: { currency: 'CHF', startingFreeCashFlow: fcff.value!, forecastYears: 5,
        annualGrowthRate: row.dcfGrowth + 0.02, discountRate: row.discountRate - 0.01,
        terminalGrowthRate: 0.025, netDebt: row.netDebt, sharesOutstanding: row.sharesOutstanding,
        dataAsOf: '2026-09-28T00:00:00.000Z', sourceReferences: [`synthetic-example:${row.ticker}:fictional-inputs`] },
    });
    return { ...row, revenueGrowth: row.revenue / row.revenuePrior - 1,
      operatingMargin: row.ebit / row.revenue, fcff: fcff.value!, fcffFormula: fcff.formula,
      dcf,
      researchStatus: 'illustrative_scenario' as const,
      informationGap: 'No independent issuer evidence or real total-return history.' };
  }),
};
