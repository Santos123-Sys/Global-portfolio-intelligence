import { describe, expect, it } from 'vitest';
import { ibkrPreviewRequestSchema, ibkrPreviewSchema, ibkrSnapshotSchema } from '@/lib/ibkr-service';

describe('IBKR trust boundary', () => {
  it('accepts a read-only snapshot and rejects a response that claims write access', () => {
    const snapshot = {
      provider: 'interactive_brokers', read_only: true, account_masked: '…4567', base_currency: 'USD',
      cash: 100, net_liquidation: 500, available_funds: 80, buying_power: 160,
      captured_at: '2026-09-29T10:00:00+00:00', positions: [], information_gaps: [],
    };
    expect(ibkrSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(ibkrSnapshotSchema.safeParse({ ...snapshot, read_only: false }).success).toBe(false);
  });

  it('normalizes identifiers and requires a price for limit previews', () => {
    expect(ibkrPreviewRequestSchema.parse({ symbol: ' aapl ', exchange: ' smart ', currency: 'usd', amount: 500,
      side: 'BUY', order_type: 'MKT' }).symbol).toBe('AAPL');
    expect(ibkrPreviewRequestSchema.safeParse({ symbol: 'AAPL', exchange: 'SMART', currency: 'USD', amount: 500,
      side: 'BUY', order_type: 'LMT' }).success).toBe(false);
  });

  it('only accepts a preview that explicitly says it was not transmitted', () => {
    const preview = { provider: 'interactive_brokers', preview_only: true, transmitted: false, symbol: 'AAPL',
      exchange: 'SMART', currency: 'USD', side: 'BUY', order_type: 'MKT', limit_price: null,
      reference_price: 200, requested_amount: 500, quantity: 2, estimated_value: 400, eligible: true, blockers: [] };
    expect(ibkrPreviewSchema.safeParse(preview).success).toBe(true);
    expect(ibkrPreviewSchema.safeParse({ ...preview, transmitted: true }).success).toBe(false);
  });
});
