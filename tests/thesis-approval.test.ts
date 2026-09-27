import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyThesisPolicy } from '@portfolio-intelligence/agentic-contract';
const mocks = vi.hoisted(() => ({
  rows: [] as unknown[][],
  writes: [] as unknown[],
  transaction: vi.fn(),
  start: vi.fn(),
  locks: vi.fn(),
}));
vi.mock('../src/lib/api-auth', () => ({
  authenticateRequest: async () => ({
    ok: true,
    auth: { userId: 'owner', email: 'owner@example.test' },
  }),
}));
vi.mock('../src/lib/auth', () => ({ assertSameOrigin: () => {} }));
vi.mock('../src/lib/thesis-discovery-transition', () => ({
  startDiscoveryAfterThesisConfirmation: mocks.start,
}));
vi.mock('../src/lib/db', () => ({ db: { transaction: mocks.transaction } }));
import { POST } from '../src/app/api/thesis/route';
const activeId = '11111111-1111-4111-8111-111111111111';
const createdId = '22222222-2222-4222-8222-222222222222';
const body = () => ({
  baseVersionId: activeId,
  startDiscovery: false,
  criteriaJson: {
    version: 2,
    portfolios: [
      {
        role: 'swiss_quality',
        currency: 'CHF',
        objective: 'Durable growth',
        inclusionCriteria: [],
        exclusionCriteria: [],
        policy: {
          ...emptyThesisPolicy(),
          universe: {
            ...emptyThesisPolicy().universe,
            listingMarkets: ['XSWX'],
          },
        },
      },
    ],
    globalConstraints: [],
  },
});
function query(rows: unknown[]) {
  const p = Promise.resolve(rows);
  return Object.assign(p, {
    from: () => p,
    where: () => p,
    orderBy: () => p,
    limit: () => p,
  });
}
beforeEach(() => {
  mocks.rows = [[{ versionNumber: 1 }], [{ id: activeId }], []];
  mocks.writes = [];
  mocks.start.mockReset();
  mocks.transaction.mockReset();
  mocks.locks.mockReset();
  const tx = {
    execute: mocks.locks,
    select: () => query(mocks.rows.shift() ?? []),
    update: () => ({
      set: (data: unknown) => ({
        where: async () => {
          mocks.writes.push(data);
        },
      }),
    }),
    insert: () => ({
      values: (data: unknown) => {
        mocks.writes.push(data);
        return Object.assign(Promise.resolve(), {
          returning: async () => [{ id: createdId }],
        });
      },
    }),
  };
  mocks.transaction.mockImplementation(async (cb) => cb(tx));
});
const submit = (value: unknown) =>
  POST(
    new Request('http://localhost/api/thesis', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    }),
  );
describe('thesis approval boundary', () => {
  it('rejects a stale active version before writing or starting Discovery', async () => {
    const input = body();
    input.baseVersionId = createdId;
    const r = await submit(input);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain('changed');
    expect(mocks.writes).toEqual([]);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('rejects duplicate or stale version numbers', async () => {
    const input = body();
    input.criteriaJson.version = 1;
    expect((await submit(input)).status).toBe(409);
    expect(mocks.writes).toEqual([]);
  });
  it('blocks contradictions before persistence', async () => {
    const input = body();
    Object.assign(input.criteriaJson.portfolios[0].policy, {
      targetHoldings: 20,
      maximumHoldings: 6,
    });
    expect((await submit(input)).status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('requires acknowledgment of qualitative ambiguity', async () => {
    const input = body();
    input.criteriaJson.portfolios[0].policy.rules.push({
      statement: 'High quality',
      kind: 'preference',
      category: 'selection',
    });
    expect((await submit(input)).status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('saves an immutable version and supports approval without Discovery', async () => {
    const response = await submit(body());
    expect(response.status).toBe(201);
    expect((await response.json()).discoveryTransition.status).toBe(
      'not_requested',
    );
    expect(mocks.locks).toHaveBeenCalledOnce();
    expect(mocks.writes.length).toBeGreaterThan(0);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('hands off only the persisted version and retains approval if the provider is blocked', async () => {
    mocks.start.mockResolvedValue({
      status: 'blocked',
      errorMessage: 'Provider unavailable',
    });
    const response = await submit({ ...body(), startDiscovery: true });
    expect(response.status).toBe(201);
    expect(mocks.start).toHaveBeenCalledWith({
      ownerId: 'owner',
      thesisVersionId: createdId,
    });
    expect((await response.json()).discoveryTransition.status).toBe('blocked');
  });
});
