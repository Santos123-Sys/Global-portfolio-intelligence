import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ select: vi.fn(), transaction: vi.fn(), update: vi.fn(), start: vi.fn(), fetch: vi.fn(), events: [] as string[] }));
vi.mock('../src/lib/db', () => ({ db: { select: mocks.select, transaction: mocks.transaction, update: mocks.update } }));
vi.mock('../src/lib/integrations/agentic-client', () => ({ startExternalDiscoveryRun: mocks.start, fetchExternalDiscoveryRun: mocks.fetch, startExternalAgenticRun: vi.fn() }));
vi.mock('../src/lib/env', () => ({ getEnv: () => ({ DISCOVERY_UNIVERSE_LIMIT: 2000, DISCOVERY_RESEARCH_BUDGET: 40 }) }));
import { recoverDiscoveryDispatch } from '../src/lib/discovery-workflow';
const ownerId = '11111111-1111-4111-8111-111111111111';
const thesisVersionId = '22222222-2222-4222-8222-222222222222';
const dispatchId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const run = { id: runId, ownerId, thesisVersionId, externalDiscoveryId: `discovery_${dispatchId}`, status: 'dispatching', requestJson: { dispatchId, thesis: { versionId: thesisVersionId, criteria: { version: 1, portfolios: [{ role: 'swiss_quality', currency: 'CHF', objective: 'Quality', inclusionCriteria: [], exclusionCriteria: [] }], globalConstraints: [] } },
  portfolios: [{ id: ownerId, name: 'Swiss', role: 'swiss_quality', baseCurrency: 'CHF', investmentObjective: 'Quality' }],
  universe: [{ ticker: 'AAA', exchange: 'XSWX', companyName: 'Example', currency: 'CHF', country: null, sector: null, industry: null, assetType: 'Common Stock', observedAt: '2026-09-27T00:00:00.000Z', provider: 'test', sourceUrl: 'https://example.test/list', attributes: {} }], maxCandidatesPerPortfolio: 6 }, errorMessage: null };
function query(rows: unknown[]) { const p = Promise.resolve(rows); return Object.assign(p, { from: () => p, where: () => p, orderBy: () => p, limit: () => p }); }
function tx(active: boolean) {
  const rows = [[run], active ? [{ id: thesisVersionId }] : []];
  return { execute: async () => mocks.events.push('lock'), select: () => query(rows.shift() ?? []),
    update: () => ({ set: (values: Record<string, unknown>) => ({ where: () => ({ returning: async () => { Object.assign(run, values); return [run]; } }) }) }) };
}
describe('durable discovery intent', () => {
  it('recovers a lost acceptance response with the same dispatch ID and saved payload', async () => {
    mocks.events = []; mocks.start.mockReset(); mocks.fetch.mockReset();
    mocks.transaction.mockImplementation(async callback => callback(tx(true)));
    mocks.start.mockImplementationOnce(async (request: { dispatchId: string }) => {
      mocks.events.push(`accepted:${request.dispatchId}`);
      throw new Error('Response lost after acceptance');
    }).mockImplementationOnce(async (request: { dispatchId: string }) => {
      mocks.events.push(`retry:${request.dispatchId}`);
      return { externalDiscoveryId: `discovery_${request.dispatchId}`, status: 'queued' };
    });
    expect((await recoverDiscoveryDispatch(runId, ownerId)).status).toBe('dispatching');
    mocks.select.mockReturnValueOnce(query([run])).mockReturnValueOnce(query([{ id: thesisVersionId }]));
    mocks.update.mockReturnValue({ set: (values: Record<string, unknown>) => ({ where: () => ({ returning: async () => [{ ...run, ...values }] }) }) });
    expect((await recoverDiscoveryDispatch(runId, ownerId)).status).toBe('queued');
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.start.mock.calls[0][0]).toEqual(mocks.start.mock.calls[1][0]);
    expect(mocks.events).toEqual(['lock', `accepted:${dispatchId}`, 'lock', `retry:${dispatchId}`]);
  });
  it('never creates a new job after thesis supersession', async () => {
    run.status = 'dispatching'; mocks.start.mockReset(); mocks.fetch.mockReset();
    mocks.transaction.mockImplementation(async callback => callback(tx(false)));
    mocks.fetch.mockRejectedValueOnce(new Error('External Agentic System returned 404'));
    expect((await recoverDiscoveryDispatch(runId, ownerId)).status).toBe('failed');
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.fetch).toHaveBeenCalledWith(run.externalDiscoveryId);
  });
});
