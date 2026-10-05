import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyThesisPolicy } from '@portfolio-intelligence/agentic-contract';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  start: vi.fn(),
  writes: [] as unknown[],
  locks: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ authenticateRequest: vi.fn(async () => ({ auth: { userId: '00000000-0000-4000-8000-000000000001' } })), requireRole: vi.fn(() => null), assertSameOrigin: vi.fn() }));
vi.mock('@/lib/services/thesis-discovery', () => ({ startThesisDiscovery: mocks.start }));
vi.mock('@/lib/db', () => ({
  db: {
    transaction: mocks.transaction,
    query: {
      thesisExtractions: { findFirst: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000010', ownerId: '00000000-0000-4000-8000-000000000001', status: 'completed', criteriaJson: body().criteriaJson })) },
      theses: { findFirst: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000020', ownerId: '00000000-0000-4000-8000-000000000001', activeVersionId: '00000000-0000-4000-8000-000000000030' })) },
      thesisVersions: { findFirst: vi.fn(async ({ where }: unknown) => ({ id: '00000000-0000-4000-8000-000000000030', thesisId: '00000000-0000-4000-8000-000000000020', version: 1, criteriaJson: body().criteriaJson })) },
    },
  },
}));
vi.mock('@/lib/schema', () => ({
  thesisExtractions: {}, theses: {}, thesisVersions: {}, auditEvents: {}, discoveryRuns: {},
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn((...args) => args), and: vi.fn((...args) => args), desc: vi.fn((value) => value), sql: vi.fn((strings: TemplateStringsArray) => strings.join('')) }));

function basePolicy() {
  return {
    ...emptyThesisPolicy(),
    name: 'Swiss Quality',
    strategy: 'Durable compounders',
    horizon: '5+ years',
    universe: { ...emptyThesisPolicy().universe, listingMarkets: ['XSWX'] },
  };
}

function body() {
  return {
    extractionId: '00000000-0000-4000-8000-000000000010',
    thesisId: '00000000-0000-4000-8000-000000000020',
    activeVersionId: '00000000-0000-4000-8000-000000000030',
    criteriaJson: {
      version: 2,
      portfolios: [{ role: 'swiss_quality', currency: 'CHF', objective: 'Durable compounding', inclusionCriteria: [], exclusionCriteria: [], policy: basePolicy() }],
      globalConstraints: [],
    },
    reviewNotes: 'Reviewed',
    startDiscovery: false,
    acknowledgeWarnings: false,
  };
}

function makeTransaction() {
  return async (fn: (tx: unknown) => Promise<unknown>) => fn({
    execute: mocks.locks,
    query: {
      theses: { findFirst: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000020', activeVersionId: '00000000-0000-4000-8000-000000000030' })) },
      thesisVersions: { findFirst: vi.fn(async () => null) },
      thesisExtractions: { findFirst: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000010', ownerId: '00000000-0000-4000-8000-000000000001', status: 'completed' })) },
    },
    insert: vi.fn(() => ({ values: vi.fn((value) => { mocks.writes.push(value); return { returning: vi.fn(async () => [{ id: '00000000-0000-4000-8000-000000000040', version: 2, criteriaJson: body().criteriaJson }]) }; }) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
  });
}

async function submit(input: ReturnType<typeof body>) {
  const { POST } = await import('../src/app/api/thesis/approve/route');
  return POST(new NextRequest('http://localhost/api/thesis/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }));
}

describe('thesis approval boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.writes.length = 0; mocks.transaction.mockImplementation(makeTransaction()); mocks.start.mockResolvedValue({ status: 'queued', runId: '00000000-0000-4000-8000-000000000050' });
  });
  it('requires a completed system extraction as the source for every canonical version', async () => {
    const input = body(); input.extractionId = '00000000-0000-4000-8000-000000000099';
    const r = await submit(input); expect(r.status).toBe(404); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('rejects a stale active version before writing or starting Discovery', async () => {
    const input = body(); input.activeVersionId = '00000000-0000-4000-8000-000000000099';
    const r = await submit(input); expect(r.status).toBe(409); expect((await r.json()).error).toContain('changed'); expect(mocks.writes).toEqual([]); expect(mocks.start).not.toHaveBeenCalled();
  });
  it('rejects duplicate or stale version numbers', async () => {
    const input = body(); input.criteriaJson.version = 1;
    expect((await submit(input)).status).toBe(409); expect(mocks.writes).toEqual([]);
  });
  it('blocks contradictions before persistence', async () => {
    const input = body(); Object.assign(input.criteriaJson.portfolios[0].policy, { targetHoldings: 20, maximumHoldings: 6 });
    expect((await submit(input)).status).toBe(422); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('requires acknowledgment of unresolved hard qualitative ambiguity', async () => {
    const input = body();
    input.criteriaJson.portfolios[0].policy.rules.push({ statement: 'High quality', kind: 'hard', category: 'selection' });
    expect((await submit(input)).status).toBe(422); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('saves an immutable version and supports approval without Discovery', async () => {
    const response = await submit(body()); expect(response.status).toBe(201); expect((await response.json()).discoveryTransition.status).toBe('not_requested'); expect(mocks.locks).toHaveBeenCalledOnce(); expect(mocks.writes.length).toBeGreaterThan(0); expect(mocks.start).not.toHaveBeenCalled();
  });
  it('hands off only the persisted version and retains approval if the provider is blocked', async () => {
    mocks.start.mockResolvedValue({ status: 'blocked', reason: 'Provider unavailable' });
    const input = body(); input.startDiscovery = true;
    const response = await submit(input); expect(response.status).toBe(201); expect((await response.json()).discoveryTransition.status).toBe('blocked'); expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ versionId: '00000000-0000-4000-8000-000000000040' }));
  });
});
