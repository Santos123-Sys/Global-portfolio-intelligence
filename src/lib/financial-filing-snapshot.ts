import { isSupportedFiscalDate } from './financial-evidence';

/** Select one fiscal date, source and filing label; conflicting facts stay missing. */
export function selectFilingSnapshot<T extends {
  provider: string; metricName: string; observationDate: string | null;
  sourceUrl: string | null; sourceName?: string | null; currency: string | null; retrievedAt: Date;
  valueNumeric: string | null;
}>(observations: T[], currency: string, metrics: readonly string[]): Map<string, T> {
  const eligible = observations.filter((row) => row.provider === 'investor-relations'
    && isSupportedFiscalDate(row.observationDate) && row.sourceUrl
    && (row.currency === currency || row.metricName === 'shares_outstanding'));
  const selected = [...eligible].sort((left, right) =>
    right.observationDate!.localeCompare(left.observationDate!) || right.retrievedAt.getTime() - left.retrievedAt.getTime())[0];
  const result = new Map<string, T>();
  if (!selected) return result;
  for (const metric of metrics) {
    const matches = eligible.filter((row) => row.metricName === metric
      && row.observationDate === selected.observationDate && row.sourceUrl === selected.sourceUrl
      && (row.sourceName ?? '') === (selected.sourceName ?? ''));
    const values = matches.map(row => row.valueNumeric?.trim() ? Number(row.valueNumeric) : NaN);
    if (!values.length || values.some(value => !Number.isFinite(value)) || new Set(values).size !== 1) continue;
    result.set(metric, [...matches].sort((a, b) => b.retrievedAt.getTime() - a.retrievedAt.getTime())[0]);
  }
  return result;
}
