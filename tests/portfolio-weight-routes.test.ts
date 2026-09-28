import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ auth: vi.fn(), owned: vi.fn(), origin: vi.fn(), engine: vi.fn(), universe: vi.fn(),
  select: vi.fn(), insert: vi.fn(), update: vi.fn(), transaction: vi.fn() }));
vi.mock('../src/lib/api-auth', () => ({ authenticateRequest: mock.auth, portfolioIsOwned: mock.owned }));
vi.mock('../src/lib/auth', () => ({ assertSameOrigin: mock.origin }));
vi.mock('../src/lib/db', () => ({ db: mock }));
vi.mock('../src/lib/portfolio-weights-service', () => ({ callWeightEngine: mock.engine, weightUniverse: mock.universe, hashSnapshot: () => 'hash' }));
import { POST, PUT } from '../src/app/api/portfolio/weights/route';
const portfolioId = '00000000-0000-4000-8000-000000000001';
const runId = '00000000-0000-4000-8000-000000000002';
const request = (method: string, body: unknown) => new Request('http://localhost/api/portfolio/weights', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const metric = { cagr: .1, vol: .2, sharpe: .4, max_drawdown: -.1, ann_turnover: .5, mad_from_base: 0, cross_run_std: 0, score: .4, eligible: true, vol_inv: 5 };
const result = { engine_version: 'portfolio-weights/1.0.0', dependencies: {}, inputs: {}, data_range: { start: '2022-01-01', end: '2026-09-28', rows: 1000 },
  weights_table: { '1/N': { A: .5, B: .5 } }, oos_summary: { '1/N': metric }, stability: { '1/N': metric },
  recommendation: { recommended_method: '1/N', recommended_weights: { A: .5, B: .5 }, stability_flag: null, constraint_flag: null, ranking: { '1/N': metric }, user_must_choose: true } };
const run = { id: runId, createdAt: new Date(), confirmedAt: null, resultJson: result, configJson: { per_asset_max: .6 }, holdingsHash: 'holdings', currency: 'BRL', baseDecisionId: null };
function query(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy']) chain[name] = () => chain;
  chain.limit = () => Promise.resolve(rows);
  chain.for = () => Promise.resolve(rows);
  return chain;
}
beforeEach(() => {
  vi.resetAllMocks();
  mock.auth.mockResolvedValue({ ok: true, auth: { userId: portfolioId, actorUserId: runId } });
  mock.owned.mockResolvedValue(true);
  mock.universe.mockResolvedValue({ portfolio: { baseCurrency: 'BRL' }, assets: ['A', 'B'], holdingsHash: 'holdings' });
  mock.transaction.mockImplementation(fn => fn(mock));
});
describe('portfolio weight route safeguards', () => {
  it('rejects unauthenticated or cross-origin mutations without computation', async () => {
    mock.auth.mockResolvedValueOnce({ ok: false, response: new Response('', { status: 401 }) });
    expect((await POST(request('POST', {}))).status).toBe(401);
    mock.origin.mockImplementationOnce(() => { throw new Error('origin'); });
    expect((await PUT(request('PUT', {}))).status).toBe(403);
    expect(mock.engine).not.toHaveBeenCalled();
  });
  it('rejects foreign portfolios before reading holdings', async () => {
    mock.owned.mockResolvedValue(false);
    const response = await POST(request('POST', { portfolioId, pricesCsv: 'date,A,B\n2026-09-01,1,2', source: 'test provider', totalReturnConfirmed: true, currency: 'BRL' }));
    expect(response.status).toBe(404);
    expect(mock.universe).not.toHaveBeenCalled();
  });
  it('keeps target untouched on compute failure', async () => {
    mock.select.mockReturnValue(query([]));
    mock.engine.mockRejectedValue(new Error('Insufficient history'));
    const response = await POST(request('POST', { portfolioId, pricesCsv: 'date,A,B\n2026-09-01,1,2', source: 'test provider', totalReturnConfirmed: true, currency: 'BRL' }));
    expect(response.status).toBe(422);
    expect(mock.insert).not.toHaveBeenCalled(); expect(mock.update).not.toHaveBeenCalled();
  });
  it('blocks custom weights until untested-weight warning is acknowledged', async () => {
    mock.select.mockReturnValue(query([run]));
    const response = await PUT(request('PUT', { portfolioId, runId, userChoice: { A: 50, B: 50 }, confirm: true, warningsAcknowledged: false }));
    expect(response.status).toBe(409); expect(mock.engine).not.toHaveBeenCalled();
  });
  it('blocks stale targets and never overwrites a newer confirmation', async () => {
    mock.select.mockReturnValueOnce(query([run])).mockReturnValueOnce(query([{ id: portfolioId }])).mockReturnValueOnce(query([{ id: 'newer-decision' }]));
    mock.engine.mockResolvedValue({ final_weights: { A: .5, B: .5 }, source: 'user accepted system recommendation', was_user_decision: true,
      audit: { recommended_method: '1/N', user_choice: 'recommendation', stability_flag: null, constraint_flag: null } });
    const response = await PUT(request('PUT', { portfolioId, runId, userChoice: 'recommendation', confirm: true, warningsAcknowledged: false }));
    expect(response.status).toBe(409); expect(mock.update).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('target changed') });
  });
  it('persists the audited explicit choice atomically', async () => {
    mock.select.mockReturnValueOnce(query([run])).mockReturnValueOnce(query([{ id: portfolioId }])).mockReturnValueOnce(query([]));
    const final = { final_weights: { A: .5, B: .5 }, source: 'user accepted system recommendation', was_user_decision: true,
      audit: { recommended_method: '1/N', user_choice: 'recommendation', stability_flag: null, constraint_flag: null } };
    mock.engine.mockResolvedValue(final);
    const set = vi.fn().mockReturnValue({ where: () => ({ returning: () => Promise.resolve([{ id: runId }]) }) });
    mock.update.mockReturnValue({ set });
    const response = await PUT(request('PUT', { portfolioId, runId, userChoice: 'recommendation', confirm: true, warningsAcknowledged: false }));
    expect(response.status).toBe(200);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ finalJson: final, confirmedBy: runId }));
  });
});
