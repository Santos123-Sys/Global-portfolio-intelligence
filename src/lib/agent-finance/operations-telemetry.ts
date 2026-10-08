export interface ResearchOperationsRow {
  status: string;
  createdAt: Date;
  budgetStartedAt: Date | null;
  budgetActiveMs: number;
  completedAt: Date | null;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  unmeteredModelCalls: number;
  estimatedCostUsd: string | null;
}

export const RESEARCH_SCALE_GATE = {
  windowHours: 24,
  minimumStartedSessions: 20,
  minimumObservedHours: 1,
  queueWaitP95Seconds: 120,
  canonicalOccupancyRatio: 0.7,
} as const;

function percentile(values: number[], percentileValue: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)] ?? null;
}

/**
 * Produces an operator-facing decision record from persisted session facts.
 * A second pool is recommended only when both demand and user-visible delay
 * are sustained; a brief burst must not create a continuously deployed service.
 */
export function summarizeResearchOperations(
  rows: ResearchOperationsRow[],
  now = new Date()
) {
  const windowMs = RESEARCH_SCALE_GATE.windowHours * 60 * 60_000;
  const cutoff = now.getTime() - windowMs;
  const active = rows.filter((row) => row.status === 'queued' || row.status === 'running');
  const queued = active.filter((row) => row.status === 'queued');
  const started = rows.filter((row) => row.budgetStartedAt !== null && row.budgetStartedAt.getTime() >= cutoff);
  const queueWaits = started.map((row) => Math.max(0, row.budgetStartedAt!.getTime() - row.createdAt.getTime()));
  const earliestStart = started.reduce<number | null>((value, row) => {
    const startedAt = row.budgetStartedAt!.getTime();
    return value === null || startedAt < value ? startedAt : value;
  }, null);
  const observedMs = earliestStart === null ? 0 : Math.min(windowMs, Math.max(0, now.getTime() - earliestStart));
  const activeMs = started.reduce((total, row) => total + Math.max(0, row.budgetActiveMs), 0);
  const occupancyRatio = observedMs === 0 ? null : Math.min(1, activeMs / observedMs);
  const queueWaitP95Seconds = (() => {
    const value = percentile(queueWaits, 0.95);
    return value === null ? null : Math.round(value / 1000);
  })();
  const enoughEvidence =
    started.length >= RESEARCH_SCALE_GATE.minimumStartedSessions &&
    observedMs >= RESEARCH_SCALE_GATE.minimumObservedHours * 60 * 60_000;
  const queueWaitGate = enoughEvidence && queueWaitP95Seconds !== null
    ? queueWaitP95Seconds >= RESEARCH_SCALE_GATE.queueWaitP95Seconds
    : null;
  const occupancyGate = enoughEvidence && occupancyRatio !== null
    ? occupancyRatio >= RESEARCH_SCALE_GATE.canonicalOccupancyRatio
    : null;
  const recommendation = !enoughEvidence
    ? 'collecting_evidence'
    : queueWaitGate && occupancyGate
      ? 'consider_second_pool'
      : 'hold';

  const knownCosts = started
    .map((row) => row.estimatedCostUsd === null ? null : Number(row.estimatedCostUsd))
    .filter((value): value is number => value !== null && Number.isFinite(value));

  return {
    windowHours: RESEARCH_SCALE_GATE.windowHours,
    queue: {
      queued: queued.length,
      running: active.length - queued.length,
      oldestQueuedSeconds: queued.length
        ? Math.max(...queued.map((row) => Math.max(0, Math.round((now.getTime() - row.createdAt.getTime()) / 1000))))
        : null,
      queueWaitP95Seconds,
      startedSampleSize: started.length,
    },
    canonicalWorker: {
      occupancyRatio,
      observedHours: Number((observedMs / 3_600_000).toFixed(2)),
      completed: started.filter((row) => row.status === 'completed').length,
      failed: started.filter((row) => row.status === 'failed').length,
    },
    usage: {
      modelCalls: started.reduce((total, row) => total + row.modelCalls, 0),
      inputTokens: started.reduce((total, row) => total + row.inputTokens, 0),
      outputTokens: started.reduce((total, row) => total + row.outputTokens, 0),
      unmeteredModelCalls: started.reduce((total, row) => total + row.unmeteredModelCalls, 0),
      estimatedCostUsd: started.length > 0 && knownCosts.length === started.length
        ? Number(knownCosts.reduce((total, value) => total + value, 0).toFixed(6))
        : null,
    },
    scaleDecision: {
      recommendation,
      enoughEvidence,
      queueWaitGate,
      occupancyGate,
      thresholds: RESEARCH_SCALE_GATE,
    },
  };
}

export type ResearchOperationsTelemetry = ReturnType<typeof summarizeResearchOperations>;
