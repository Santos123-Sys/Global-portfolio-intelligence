import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ sector: 'Industrials', facts: [] as Array<Record<string, unknown>>, saved: null as Record<string, unknown> | null, selects: 0 }));
vi.mock('../src/lib/api-auth', () => ({ authenticateRequest: async () => ({ ok: true, auth: { userId: 'owner', email: 'owner@example.test' } }) }));
vi.mock('../src/lib/auth', () => ({ assertSameOrigin: () => undefined }));
vi.mock('../src/lib/db', () => ({ db: {
  select: () => {
    state.selects++;
    return { from: () => ({ where: () => ({
      limit: async () => [{ id: '11111111-1111-4111-8111-111111111111', securityId: 'security', analysisId: 'analysis', currency: 'CHF', sector: state.sector }],
      orderBy: async () => state.facts,
    }) }) };
  },
  insert: () => ({ values: (value: Record<string, unknown>) => { state.saved = value; return { returning: async () => [{ id: 'scenario', ...value }] }; } }),
} }));
import { POST } from '../src/app/api/discovery/valuations/route';

const fiscalDate = '2025-12-31';
beforeEach(() => {
  state.sector = 'Industrials'; state.selects = 0; state.saved = null;
  const values: Record<string, number> = { free_cash_flow_to_firm: 100, total_debt: 50, cash_and_equivalents: 20, shares_outstanding: 10 };
  for (const name of ['worst_case', 'base_case', 'optimistic_case']) {
    values[`dcf_${name}_fcf_growth_rate`] = 0.04;
    values[`dcf_${name}_discount_rate`] = 0.10;
    values[`dcf_${name}_terminal_growth_rate`] = 0.02;
  }
  state.facts = Object.entries(values).map(([metricName, value]) => ({ id: metricName, metricName, valueNumeric: String(value), currency: 'CHF', observationDate: fiscalDate, retrievedAt: new Date('2026-09-26'), provider: 'investor-relations', sourceName: 'Annual filing', sourceUrl: 'https://issuer.test/annual' }));
});
const submit = () => POST(new Request('http://localhost/api/discovery/valuations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId: '11111111-1111-4111-8111-111111111111', automatic: true }) }));

describe('valuation API method and evidence gates', () => {
  it('does not accept generic FCF in place of explicitly identified FCFF', async () => {
    state.facts[0].metricName = 'free_cash_flow';
    const response = await submit();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('not automatically FCFF');
    expect(state.saved).toBeNull();
  });
  it('enforces method suitability even when every numerical input exists', async () => {
    state.sector = 'Financial Services';
    const response = await submit();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('poor fit');
    expect(state.saved).toBeNull();
  });
  it('rejects conflicting facts instead of selecting an arbitrary value', async () => {
    state.facts.push({ ...state.facts[0], valueNumeric: '200' });
    expect((await submit()).status).toBe(409);
    expect(state.saved).toBeNull();
  });
  it('uses the financial fiscal date, not the latest retrieval date, in the saved scenario', async () => {
    const response = await submit();
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.result.scenarios[1].result.assumptions.dataAsOf).toBe(fiscalDate);
  });
});
