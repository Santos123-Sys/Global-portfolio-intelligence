import { describe, expect, it } from 'vitest';
import { summarizeResearchOperations, type ResearchOperationsRow } from '../src/lib/agent-finance/operations-telemetry';

const now = new Date('2026-10-08T12:00:00.000Z');

function row(index: number, overrides: Partial<ResearchOperationsRow> = {}): ResearchOperationsRow {
  const createdAt = new Date(now.getTime() - (120 - index) * 60_000);
  return {
    status: 'completed',
    createdAt,
    budgetStartedAt: new Date(createdAt.getTime() + 130_000),
    budgetActiveMs: 6 * 60_000,
    completedAt: new Date(createdAt.getTime() + 8 * 60_000),
    modelCalls: 4,
    inputTokens: 1_000,
    outputTokens: 250,
    unmeteredModelCalls: 0,
    estimatedCostUsd: '0.250000',
    ...overrides,
  };
}

describe('research operations telemetry', () => {
  it('requires enough observed workload before making a pool decision', () => {
    const result = summarizeResearchOperations([row(0)], now);
    expect(result.scaleDecision).toMatchObject({ recommendation: 'collecting_evidence', enoughEvidence: false });
  });

  it('recommends considering a second pool only when wait and occupancy gates are both sustained', () => {
    const result = summarizeResearchOperations(Array.from({ length: 20 }, (_, index) => row(index)), now);
    expect(result.queue.queueWaitP95Seconds).toBe(130);
    expect(result.canonicalWorker.occupancyRatio).toBe(1);
    expect(result.scaleDecision).toMatchObject({
      recommendation: 'consider_second_pool',
      queueWaitGate: true,
      occupancyGate: true,
    });
  });

  it('holds the single pool when queue waits remain healthy', () => {
    const rows = Array.from({ length: 20 }, (_, index) => row(index, {
      budgetStartedAt: new Date(now.getTime() - (120 - index) * 60_000 + 10_000),
    }));
    const result = summarizeResearchOperations(rows, now);
    expect(result.scaleDecision).toMatchObject({ recommendation: 'hold', queueWaitGate: false });
  });

  it('reports current backlog and withholds aggregate cost when any session is unpriced', () => {
    const result = summarizeResearchOperations([
      row(0, { status: 'queued', budgetStartedAt: null, estimatedCostUsd: null }),
      ...Array.from({ length: 20 }, (_, index) => row(index, index === 0 ? { estimatedCostUsd: null } : {})),
    ], now);
    expect(result.queue).toMatchObject({ queued: 1, running: 0 });
    expect(result.usage.estimatedCostUsd).toBeNull();
  });
});
