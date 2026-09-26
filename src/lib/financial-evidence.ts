/** Calendar-valid fiscal date, not a retrieval timestamp. Future filings are not evidence. */
export function isSupportedFiscalDate(value: string | null, now = new Date()): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    && value <= now.toISOString().slice(0, 10);
}

export const FCFF_METRIC = 'free_cash_flow_to_firm';
export const FCFF_EVIDENCE_NOTE = 'Automatic FCFF valuation requires explicitly verified free cash flow to the firm. Operating cash flow minus capital expenditure is not automatically FCFF; no conversion or financing assumption is inferred.';
