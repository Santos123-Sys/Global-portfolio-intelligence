import { z } from 'zod';

const finiteNumber = z.number().finite();
export const ibkrPositionSchema = z.object({
  con_id: z.number().int().nonnegative(), symbol: z.string().min(1).max(20),
  exchange: z.string().max(20), currency: z.string().length(3),
  quantity: finiteNumber.positive(), avg_cost: finiteNumber.nonnegative(),
  last_price: finiteNumber.nonnegative(), cost_basis: finiteNumber.nonnegative(),
  market_value: finiteNumber, unrealized_pnl: finiteNumber,
  return_pct: finiteNumber.nullable(), first_detected_fill: z.string().date().nullable(),
  days_since_detected_fill: z.number().int().nonnegative().nullable(),
  annualized_return_pct: finiteNumber.nullable(),
}).strict();

export const ibkrSnapshotSchema = z.object({
  provider: z.literal('interactive_brokers'), read_only: z.literal(true),
  account_masked: z.string().min(1).max(40), base_currency: z.string().length(3),
  cash: finiteNumber, net_liquidation: finiteNumber, available_funds: finiteNumber,
  buying_power: finiteNumber, captured_at: z.string().datetime({ offset: true }),
  positions: z.array(ibkrPositionSchema).max(500),
  information_gaps: z.array(z.string().min(1).max(500)).max(100),
}).strict();

export const ibkrPreviewRequestSchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9.\-]{0,19}$/),
  exchange: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,12}$/),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  amount: finiteNumber.positive(), side: z.enum(['BUY', 'SELL']), order_type: z.enum(['MKT', 'LMT']),
  limit_price: finiteNumber.positive().nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.order_type === 'LMT' && value.limit_price == null) context.addIssue({ code: 'custom', path: ['limit_price'], message: 'Limit price is required' });
});

export const ibkrPreviewSchema = z.object({
  provider: z.literal('interactive_brokers'), preview_only: z.literal(true), transmitted: z.literal(false),
  symbol: z.string(), exchange: z.string(), currency: z.string(), side: z.enum(['BUY', 'SELL']),
  order_type: z.enum(['MKT', 'LMT']), limit_price: finiteNumber.nullable(), reference_price: finiteNumber.positive(),
  requested_amount: finiteNumber.positive(), quantity: z.number().int().nonnegative(), estimated_value: finiteNumber.nonnegative(),
  eligible: z.boolean(), blockers: z.array(z.string()),
}).strict();

async function callIbkr(path: 'snapshot' | 'order-preview', body?: unknown): Promise<unknown> {
  const base = process.env.FILINGS_API_URL;
  const token = process.env.FILINGS_INTERNAL_TOKEN;
  if (!base || !token || token.length < 32) throw new Error('IBKR bridge is not configured. Configure the private filings service first.');
  const response = await fetch(new URL(`/v1/ibkr/${path}`, base), {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000), cache: 'no-store',
  });
  const data = await response.json().catch(() => ({})) as { detail?: unknown };
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `IBKR bridge unavailable (${response.status})`);
  return data;
}

export async function retrieveIbkrSnapshot() { return ibkrSnapshotSchema.parse(await callIbkr('snapshot')); }
export async function previewIbkrOrder(input: z.infer<typeof ibkrPreviewRequestSchema>) {
  return ibkrPreviewSchema.parse(await callIbkr('order-preview', input));
}
