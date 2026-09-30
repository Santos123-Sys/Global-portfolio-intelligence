import { isSupportedFiscalDate } from './financial-evidence';
import { assessCompanyLifeCycle, type LifeCycleAssessment } from './company-life-cycle';

export interface FinancialObservation {
  metricName: string; valueNumeric: string | null; observationDate: string | null;
  currency: string | null; sourceUrl: string | null; sourceName: string | null;
  provider: string; status: string; retrievedAt: Date;
}
export interface AnnualFinancialRow {
  periodEnd: string; currency: string; sourceUrl: string; sourceName: string;
  metrics: Record<string, number>; revenueGrowth: number | null;
  operatingMargin: number | null; netMargin: number | null; cashConversion: number | null;
  gaps: string[]; retrievedAt: string; comparisonNote: string | null;
}
export interface FinancialAnalysisReport {
  companyName: string; ticker: string; exchange: string; currency: string;
  periods: AnnualFinancialRow[]; generatedAt: string; status: 'data_available' | 'partial_data' | 'evidence_required';
  limitations: string[];
  lifeCycle: LifeCycleAssessment;
}
const REQUIRED = ['revenue', 'operating_income', 'net_income', 'operating_cash_flow', 'capital_expenditure'] as const;
const METRICS = new Set([...REQUIRED, 'free_cash_flow', 'total_debt', 'cash_and_equivalents', 'total_equity', 'shares_outstanding', 'gross_profit']);
const ratio = (numerator: number | undefined, denominator: number | undefined) =>
  numerator != null && denominator != null && denominator > 0 ? numerator / denominator : null;

/** One coherent filing per fiscal end; never mix sources to fill missing metrics. */
export function buildFinancialAnalysisReport(input: {
  companyName: string; ticker: string; exchange: string; currency: string;
  observations: FinancialObservation[]; now?: Date;
}): FinancialAnalysisReport {
  const groups = new Map<string, FinancialObservation[]>();
  for (const fact of input.observations) {
    if (fact.provider !== 'investor-relations' || fact.status !== 'OK' || !fact.observationDate || !fact.sourceUrl
      || !isSupportedFiscalDate(fact.observationDate, input.now) || !METRICS.has(fact.metricName)
      || fact.currency !== input.currency && fact.metricName !== 'shares_outstanding') continue;
    const key = `${fact.observationDate}|${fact.sourceUrl}|${fact.sourceName ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }
  const byPeriod = new Map<string, FinancialObservation[]>();
  for (const group of groups.values()) {
    const end = group[0].observationDate!;
    const previous = byPeriod.get(end);
    if (!previous || Math.max(...group.map(row => row.retrievedAt.getTime())) > Math.max(...previous.map(row => row.retrievedAt.getTime()))) byPeriod.set(end, group);
  }
  const periods: AnnualFinancialRow[] = [...byPeriod.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-5).map(([periodEnd, group]) => {
    const metrics: Record<string, number> = {};
    const conflicts = new Set<string>();
    for (const fact of [...group].sort((a, b) => b.retrievedAt.getTime() - a.retrievedAt.getTime())) {
      const value = Number(fact.valueNumeric);
      if (!fact.valueNumeric || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) continue;
      if (metrics[fact.metricName] != null && metrics[fact.metricName] !== value) conflicts.add(fact.metricName);
      else metrics[fact.metricName] = value;
    }
    for (const metric of conflicts) delete metrics[metric];
    return { periodEnd, currency: input.currency, sourceUrl: group[0].sourceUrl!, sourceName: group[0].sourceName ?? 'Primary filing',
      metrics, revenueGrowth: null, retrievedAt: new Date(Math.max(...group.map(row => row.retrievedAt.getTime()))).toISOString(), comparisonNote: null,
      operatingMargin: ratio(metrics.operating_income, metrics.revenue),
      netMargin: ratio(metrics.net_income, metrics.revenue),
      cashConversion: ratio(metrics.free_cash_flow, metrics.revenue),
      gaps: [...REQUIRED.filter((metric) => metrics[metric] == null), ...conflicts].filter((x, i, a) => a.indexOf(x) === i),
    };
  });
  periods.forEach((period, index) => {
    const prior = periods[index - 1];
    const currentRevenue = period.metrics.revenue;
    const priorRevenue = prior?.metrics.revenue;
    const daysApart = prior ? (Date.parse(period.periodEnd) - Date.parse(prior.periodEnd)) / 86_400_000 : null;
    if (prior && daysApart != null && (daysApart < 350 || daysApart > 380)) period.comparisonNote = 'Growth withheld: fiscal dates are not approximately one year apart. Review reporting-period comparability.';
    if (prior && !period.comparisonNote
      && currentRevenue != null && priorRevenue != null && priorRevenue > 0)
      period.revenueGrowth = currentRevenue / priorRevenue - 1;
  });
  const limitations = periods.length ? ['Financial periods and retrieval dates describe different things. A recent import does not make an older filing current. Ratios and growth are calculations, not forecasts.'] : ['No verified, same-currency annual financial facts have been imported for this company.'];
  if (periods.some((period) => period.gaps.length)) limitations.push('Missing or conflicting filing metrics are shown as gaps; no value has been estimated.');
  if (periods.length < 2) limitations.push('Year-over-year analysis requires at least two consecutive annual periods.');
  if (periods.some(period => period.comparisonNote)) limitations.push('Some growth comparisons were withheld because fiscal-date spacing is inconsistent with adjacent annual periods.');
  const lifeCycle = assessCompanyLifeCycle(periods);
  return { companyName: input.companyName, ticker: input.ticker, exchange: input.exchange, currency: input.currency,
    periods, generatedAt: (input.now ?? new Date()).toISOString(), status: periods.some(period => Object.keys(period.metrics).length) ? periods.some(period => period.gaps.length) ? 'partial_data' : 'data_available' : 'evidence_required', limitations, lifeCycle };
}
