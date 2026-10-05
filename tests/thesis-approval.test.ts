import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyThesisPolicy } from '@portfolio-intelligence/agentic-contract';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const ACTIVE_ID = '00000000-0000-4000-8000-000000000030';
const CREATED_ID = '00000000-0000-4000-8000-000000000040';
const EXTERNAL_ID = 'external-test-extraction';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  start: vi.fn(),
  writes: [] as unknown[],
  locks: vi.fn(),
  currentCriteria: null as unknown,
  extractionStatus: 'completed',
  tables: {
    thesisVersions: {
      id: 'thesisVersions.id',
      ownerId: 'thesisVersions.ownerId',
      versionNumber: 'thesisVersions.versionNumber',
      excludedAt: 'thesisVersions.excludedAt',
      supersededAt: 'thesisVersions.supersededAt',
    },
    portfolios: {
      ownerId: 'portfolios.ownerId',
      portfolioType: 'portfolios.portfolioType',
    },
    externalThesisExtractions: {
      id: 'externalThesisExtractions.id',
      externalExtractionId: 'externalThesisExtractions.externalExtractionId',
      ownerId: 'externalThesisExtractions.ownerId',
      dismissedAt: 'externalThesisExtractions.dismissedAt',
    },
    thesisMutationAudit: { id: 'thesisMutationAudit.id' },
  },
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateRequest: vi.fn(async () => ({
    ok: true,
    auth: { userId: USER_ID, email: 'owner@example.com' },
  })),
}));
vi.mock('@/lib/auth', () => ({ assertSameOrigin: vi.fn() }));
vi.mock('@/lib/thesis-discovery-transition', () => ({
  startDiscoveryAfterThesisConfirmation: mocks.start,
}));
vi.mock('@/lib/db/schema', () => ({
  thesisVersions: mocks.tables.thesisVersions,
  portfolios: mocks.tables.portfolios,
}));
vi.mock('@/lib/db/workflow-schema', () => ({
  externalThesisExtractions: mocks.tables.externalThesisExtractions,
  thesisMutationAudit: mocks.tables.thesisMutationAudit,
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((value: unknown) => value),
  isNull: vi.fn((value: unknown) => value),
  sql: vi.fn((strings: TemplateStringsArray) => strings.join('')),
}));
vi.mock('@/lib/db', () => ({ db: { transaction: mocks.transaction } }));

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
    externalExtractionId: EXTERNAL_ID,
    baseVersionId: ACTIVE_ID,
    criteriaJson: {
      version: 2,
      portfolios: [
        {
          role: 'swiss_quality',
          currency: 'CHF',
          objective: 'Durable compounding',
          inclusionCriteria: [],
          exclusionCriteria: [],
          policy: basePolicy(),
        },
      ],
      globalConstraints: [],
    },
    reviewNotes: 'Reviewed',
    startDiscovery: false,
  };
}

function makeTransaction() {
  return async (fn: (tx: unknown) => Promise<unknown>) => {
    let thesisVersionRead = 0;
    const tx = {
      execute: mocks.locks,
      select: vi.fn(() => ({
        from: (table: unknown) => {
          if (table === mocks.tables.thesisVersions) {
            thesisVersionRead += 1;
            return {
              where: () => ({
                orderBy: () => ({
                  limit: async () =>
                    thesisVersionRead === 1
                      ? [{ versionNumber: 1 }]
                      : [{ id: ACTIVE_ID, versionNumber: 1 }],
                }),
              }),
            };
          }
          if (table === mocks.tables.externalThesisExtractions) {
            return {
              where: () => ({
                limit: async () => [
                  {
                    id: '00000000-0000-4000-8000-000000000010',
                    externalExtractionId: EXTERNAL_ID,
                    ownerId: USER_ID,
                    status: mocks.extractionStatus,
                    confirmedAt: null,
                    requestedVersion: 2,
                    resultJson: {
                      criteria: mocks.currentCriteria,
                      extractionConfidence: 1,
                      ambiguousPoints: [],
                      unmappedContent: [],
                    },
                    investorProfileJson: null,
                  },
                ],
              }),
            };
          }
          if (table === mocks.tables.portfolios) {
            return { where: async () => [{ portfolioType: 'swiss_quality' }] };
          }
          throw new Error('Unexpected table in thesis approval test');
        },
      })),
      insert: vi.fn((table: unknown) => ({
        values: (value: unknown) => {
          mocks.writes.push({ table, value });
          if (table === mocks.tables.thesisVersions) {
            return {
              returning: async () => [
                { id: CREATED_ID, versionNumber: 2, criteriaJson: mocks.currentCriteria },
              ],
            };
          }
          return Promise.resolve(undefined);
        },
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
      })),
    };
    return fn(tx);
  };
}

async function submit(input: ReturnType<typeof body>) {
  mocks.currentCriteria = input.criteriaJson;
  const { POST } = await import('../src/app/api/thesis/route');
  return POST(
    new NextRequest('http://localhost/api/thesis', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

describe('thesis approval boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writes.length = 0;
    mocks.currentCriteria = null;
    mocks.extractionStatus = 'completed';
    mocks.transaction.mockImplementation(makeTransaction());
    mocks.start.mockResolvedValue({
      status: 'started',
      runId: '00000000-0000-4000-8000-000000000050',
    });
  });

  it('requires a completed system extraction as the source for every canonical version', async () => {
    mocks.extractionStatus = 'running';
    const response = await submit(body());
    expect(response.status).toBe(409);
    expect(mocks.writes).toEqual([]);
  });

  it('rejects a stale active version before writing or starting Discovery', async () => {
    const input = body();
    input.baseVersionId = '00000000-0000-4000-8000-000000000099';
    const response = await submit(input);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('changed');
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

  it('requires acknowledgment of unresolved hard qualitative ambiguity', async () => {
    const input = body();
    input.criteriaJson.portfolios[0].policy.rules.push({
      statement: 'High quality',
      kind: 'hard',
      category: 'selection',
    });
    expect((await submit(input)).status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('allows a qualitative ranking preference without treating it as an eligibility ambiguity', async () => {
    const input = body();
    input.criteriaJson.portfolios[0].policy.rules.push({
      statement: 'High quality',
      kind: 'preference',
      category: 'selection',
    });
    const response = await submit(input);
    expect(response.status).toBe(201);
  });

  it('saves an immutable version and supports approval without Discovery', async () => {
    const response = await submit(body());
    expect(response.status).toBe(201);
    expect((await response.json()).discoveryTransition.status).toBe('not_requested');
    expect(mocks.locks).toHaveBeenCalledOnce();
    expect(mocks.writes.length).toBeGreaterThan(0);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('hands off only the persisted version and retains approval if the provider is blocked', async () => {
    mocks.start.mockResolvedValue({ status: 'blocked', errorMessage: 'Provider unavailable' });
    const input = body();
    input.startDiscovery = true;
    const response = await submit(input);
    expect(response.status).toBe(201);
    expect((await response.json()).discoveryTransition.status).toBe('blocked');
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ thesisVersionId: CREATED_ID, ownerId: USER_ID }),
    );
  });
});
