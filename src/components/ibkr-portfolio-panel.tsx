'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type BrokerPosition = {
  id: string; symbol: string; exchange: string; currency: string; quantity: string; avgCost: string;
  lastPrice: string; marketValue: string; unrealizedPnl: string; returnPct: number | null;
  firstDetectedFill: string | null; daysSinceDetectedFill: number | null; annualizedReturnPct: number | null;
  valuation: { fairValue: number; potentialUpside: number; asOf: string } | null;
};
type BrokerData = { configured: boolean; snapshot: null | { id: string; accountMasked: string; baseCurrency: string;
  cash: string; netLiquidation: string; availableFunds: string; buyingPower: string; informationGaps: string[]; capturedAt: string };
  positions: BrokerPosition[] };
type Preview = { preview_only: true; transmitted: false; symbol: string; currency: string; quantity: number;
  estimated_value: number; reference_price: number; eligible: boolean; blockers: string[] };

function money(value: string | number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value)); }
  catch { return `${currency} ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }
}
function percent(value: number | null) { return value == null ? 'Unavailable' : `${(value * 100).toFixed(2)}%`; }

async function fetchBrokerData(): Promise<BrokerData> {
  const response = await fetch('/api/integrations/ibkr', { cache: 'no-store' });
  if (!response.ok) throw new Error(`IBKR API returned ${response.status}`);
  return response.json() as Promise<BrokerData>;
}

export function IbkrPortfolioPanel() {
  const [data, setData] = useState<BrokerData>({ configured: false, snapshot: null, positions: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
    let active = true;
    fetchBrokerData().then(result => { if (active) setData(result); })
      .catch(error => { if (active) setMessage((error as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function synchronize() {
    setBusy(true); setMessage(null);
    const response = await fetch('/api/integrations/ibkr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'sync' }) }).catch(() => null);
    const body = await response?.json().catch(() => ({})) as BrokerData & { error?: string } | undefined;
    if (!response?.ok || !body) setMessage(body?.error ?? 'Unable to synchronize Interactive Brokers.');
    else { setData(body); setMessage('Read-only broker snapshot synchronized.'); }
    setBusy(false);
  }
  async function requestPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null); setPreview(null);
    const form = new FormData(event.currentTarget);
    const orderType = String(form.get('order_type'));
    const limit = Number(form.get('limit_price'));
    const response = await fetch('/api/integrations/ibkr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'preview', order: {
      symbol: form.get('symbol'), exchange: form.get('exchange'), currency: form.get('currency'), amount: Number(form.get('amount')),
      side: form.get('side'), order_type: orderType, limit_price: orderType === 'LMT' && limit > 0 ? limit : null,
    } }) }).catch(() => null);
    const body = await response?.json().catch(() => ({})) as { preview?: Preview; error?: string } | undefined;
    if (!response?.ok || !body?.preview) setMessage(body?.error ?? 'Unable to create the broker preview.');
    else setPreview(body.preview);
    setBusy(false);
  }

  const allocation = useMemo(() => {
    if (!data.snapshot) return [];
    const slices = data.positions.map(position => ({ label: position.symbol, value: Math.abs(Number(position.marketValue)) }));
    if (Number(data.snapshot.cash) > 0) slices.push({ label: 'Cash', value: Number(data.snapshot.cash) });
    const total = slices.reduce((sum, item) => sum + item.value, 0);
    let cursor = 0;
    const colors = ['#2563eb', '#0f766e', '#9333ea', '#ca8a04', '#dc2626', '#0891b2', '#64748b'];
    const segments = slices.map((item, index) => { const start = cursor; cursor += total ? item.value / total * 100 : 0; return `${colors[index % colors.length]} ${start}% ${cursor}%`; });
    const gradient = segments.join(', ');
    return slices.map((item, index) => ({ ...item, color: colors[index % colors.length], weight: total ? item.value / total : 0, gradient }));
  }, [data]);

  return <section className="card broker-panel" aria-label="Interactive Brokers portfolio analytics">
    <div className="section-heading"><div><p className="analysis-eyebrow">Broker portfolio</p><h2>Interactive Brokers</h2>
      <p className="note">Read-only account analytics and guarded order previews. This application cannot submit an order.</p></div>
      <div><span className="badge ok">Read only</span><button className="action-button inline-action" type="button" disabled={busy} onClick={() => void synchronize()}>{busy ? 'Working…' : 'Sync snapshot'}</button></div>
    </div>
    {message && <p className="caveat" role="status">{message}</p>}
    {loading ? <p className="note">Loading broker snapshot…</p> : !data.snapshot ? <p className="note">No broker snapshot is stored. Configure the private IBKR bridge and synchronize when TWS or IB Gateway is available.</p> : <>
      <div className="broker-metrics">
        <div><span>Account</span><strong>{data.snapshot.accountMasked}</strong></div>
        <div><span>Net liquidation</span><strong>{money(data.snapshot.netLiquidation, data.snapshot.baseCurrency)}</strong></div>
        <div><span>Cash</span><strong>{money(data.snapshot.cash, data.snapshot.baseCurrency)}</strong></div>
        <div><span>Available funds</span><strong>{money(data.snapshot.availableFunds, data.snapshot.baseCurrency)}</strong></div>
      </div>
      <p className="note">Captured {new Date(data.snapshot.capturedAt).toLocaleString()} · {data.positions.length} supported long-equity position{data.positions.length === 1 ? '' : 's'}</p>
      <div className="broker-allocation">
        <div className="broker-donut" role="img" aria-label="Gross broker allocation including positive cash" style={{ background: `conic-gradient(${allocation[0]?.gradient || '#d9e1ec 0 100%'})` }}><span>{data.positions.length}<small>holdings</small></span></div>
        <ul>{allocation.map(item => <li key={item.label}><i style={{ background: item.color }} /><span>{item.label}</span><strong>{(item.weight * 100).toFixed(1)}%</strong></li>)}</ul>
      </div>
      <div className="table-scroll"><table><caption>Broker position lifecycle and valuation comparison</caption><thead><tr><th>Security</th><th className="num">Quantity</th><th className="num">Market value</th><th className="num">Unrealized P&amp;L</th><th className="num">Return</th><th>First detected fill</th><th className="num">DCF upside</th></tr></thead><tbody>
        {data.positions.map(position => <tr key={position.id}><td><strong>{position.symbol}</strong><br /><span className="note">{position.exchange} · {position.currency}</span></td><td className="num">{Number(position.quantity).toLocaleString()}</td><td className="num">{money(position.marketValue, position.currency)}</td><td className="num">{money(position.unrealizedPnl, position.currency)}</td><td className="num">{percent(position.returnPct)}{position.annualizedReturnPct != null && <><br /><span className="note">{percent(position.annualizedReturnPct)} annualized</span></>}</td><td>{position.firstDetectedFill ?? 'Unavailable'}{position.daysSinceDetectedFill != null && <><br /><span className="note">{position.daysSinceDetectedFill} days since detected</span></>}</td><td className="num">{position.valuation ? <>{percent(position.valuation.potentialUpside)}<br /><span className="note">Fair value {money(position.valuation.fairValue, position.currency)}</span></> : 'Unavailable'}</td></tr>)}
      </tbody></table></div>
      {data.snapshot.informationGaps.length > 0 && <details><summary>Broker data limitations ({data.snapshot.informationGaps.length})</summary><ul>{data.snapshot.informationGaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul></details>}
    </>}
    <details className="broker-preview"><summary>Create a non-executable order preview</summary>
      <form className="setup-form" onSubmit={(event) => void requestPreview(event)}>
        <div className="setup-form-row"><label>Symbol<input name="symbol" required maxLength={20} placeholder="AAPL" /></label><label>Exchange<input name="exchange" required maxLength={12} placeholder="SMART" /></label></div>
        <div className="setup-form-row"><label>Currency<input name="currency" required maxLength={3} defaultValue="USD" /></label><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label></div>
        <div className="setup-form-row"><label>Side<select name="side"><option>BUY</option><option>SELL</option></select></label><label>Order type<select name="order_type"><option value="MKT">Market</option><option value="LMT">Limit</option></select></label></div>
        <label>Limit price (required for a limit preview)<input name="limit_price" type="number" min="0.0001" step="any" /></label>
        <button type="submit" disabled={busy}>Preview only</button>
      </form>
      {preview && <div className={`broker-preview-result ${preview.eligible ? 'eligible' : 'blocked'}`}><strong>{preview.eligible ? 'Guardrails passed' : 'Preview blocked'}</strong><p>{preview.quantity} {preview.symbol} · estimated {money(preview.estimated_value, preview.currency)} at reference price {money(preview.reference_price, preview.currency)}</p>{preview.blockers.length > 0 && <ul>{preview.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>}<p className="note">Preview recorded for audit. No order was transmitted.</p></div>}
    </details>
  </section>;
}
