/** A portfolio's weights may be displayed only when every holding has a usable
 * weight, or every market value is positive and denominated in the base currency.
 * Never add unconverted native amounts from different currencies. */
export interface ExposureHolding {
  id: string;
  currency: string;
  marketValueNative: string | number | null;
  weight: number | null;
}

export function portfolioExposure<T extends ExposureHolding>(rows: T[], baseCurrency: string): {
  rows: Array<T & { effectiveWeight: number }>;
  source: 'stored weights' | 'native values' | null;
  reason: string | null;
} {
  if (!rows.length) return { rows: [], source: null, reason: 'Add a position to begin.' };
  const validWeights = rows.every((row) => row.weight != null && Number.isFinite(row.weight) && row.weight >= 0);
  const weightTotal = rows.reduce((sum, row) => sum + (row.weight ?? 0), 0);
  if (validWeights && Math.abs(weightTotal - 1) <= 0.02) {
    return { rows: rows.map((row) => ({ ...row, effectiveWeight: row.weight! / weightTotal })), source: 'stored weights', reason: null };
  }
  const values = rows.map((row) => row.marketValueNative == null ? NaN : Number(row.marketValueNative));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (rows.every((row) => row.currency === baseCurrency) && values.every((value) => Number.isFinite(value) && value >= 0) && total > 0) {
    return { rows: rows.map((row, index) => ({ ...row, effectiveWeight: values[index] / total })), source: 'native values', reason: null };
  }
  return {
    rows: [], source: null,
    reason: rows.some((row) => row.currency !== baseCurrency)
      ? `Weights are unavailable. Holdings in another currency need converted portfolio weights before exposure can be calculated in ${baseCurrency}.`
      : 'Weights are unavailable. Refresh prices to value every holding before assessing exposure.',
  };
}
