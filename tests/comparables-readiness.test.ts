import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ facts: [] as Array<Record<string, unknown>>, saved: null as Record<string, unknown> | null }));
vi.mock('../src/lib/api-auth', () => ({ authenticateRequest: async () => ({ ok: true, auth: { userId: 'owner', email: 'owner@example.test' } }) }));
vi.mock('../src/lib/auth', () => ({ assertSameOrigin: () => undefined }));
vi.mock('../src/lib/db', () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: '11111111-1111-4111-8111-111111111111', securityId: 'security', analysisId: 'analysis', currency: 'CHF', companyName: 'Target' }], orderBy: async () => state.facts }) }) }),
  insert: () => ({ values: (value: Record<string, unknown>) => { state.saved = value; return { returning: async () => [{ id: 'scenario', ...value }] }; } }),
} }));
import { POST } from '../src/app/api/discovery/comparables/route';
const peers = Array.from({ length: 6 }, (_, i) => ({ companyName: `Peer ${i}`, ticker: `P${i}`, currency: 'USD', financialPeriodEnd: '2025-12-31', marketDataAsOf: '2026-09-25', marketCapitalization: 1000 + i * 100, netDebt: 100, revenue: 500, ebitda: 100, netIncome: 50, sourceUrl: 'https://example.test/peer' }));
beforeEach(() => {
  state.saved = null;
  state.facts = Object.entries({ revenue: 200, net_income: 20, total_debt: 30, cash_and_equivalents: 10, shares_outstanding: 10 }).map(([metricName, value]) => ({ id: metricName, metricName, valueNumeric: String(value), currency: 'CHF', provider: 'investor-relations', sourceName: 'Annual', sourceUrl: 'https://target.test/filing', observationDate: '2025-12-31', retrievedAt: new Date('2026-09-25') }));
});
const submit = (values: unknown) => POST(new Request('http://localhost/api/discovery/comparables', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId: '11111111-1111-4111-8111-111111111111', methodSuitabilityConfirmed: true, peers: values }) }));
it('retains target provenance and peer date/currency declarations', async () => {
  const response = await submit(peers);
  expect(response.status).toBe(201);
  expect(state.saved?.sourceReferences).toContain('fundamental:revenue:revenue');
  expect(state.saved?.assumptionsJson).toMatchObject({ dataAsOf: '2025-12-31', peers });
});
it('rejects missing debt, dates, and currency rather than silently filling them', async () => {
  for (const key of ['netDebt', 'currency', 'financialPeriodEnd', 'marketDataAsOf']) {
    const invalid = peers.map(peer => ({ ...peer, [key]: undefined }));
    expect((await submit(invalid)).status).toBe(400);
  }
  expect(state.saved).toBeNull();
});
it('does not combine target figures from different annual filings', async () => {
  state.facts[2].observationDate = '2024-12-31';
  const response = await submit(peers);
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.result.impliedValuations.filter((item: { multiple: string }) => item.multiple.startsWith('EV/')).every((item: { impliedValuePerShare: number | null }) => item.impliedValuePerShare == null)).toBe(true);
});
