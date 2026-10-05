export interface TaskSchedulerOptions {
  concurrency?: number;
  staggerMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ResolvedTaskSchedulerOptions {
  concurrency: number;
  staggerMs: number;
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/**
 * Provider calls are intentionally governed separately from research breadth.
 * A plan may contain eight useful tasks without sending eight model requests at
 * the same instant. The defaults favor reliability over minimum wall-clock time.
 */
export function resolveTaskSchedulerOptions(overrides: TaskSchedulerOptions = {}): ResolvedTaskSchedulerOptions {
  const envConcurrency = boundedInteger(process.env.AGENT_MAX_CONCURRENCY, 3, 1, 8);
  const envStaggerMs = boundedInteger(process.env.AGENT_STAGGER_MS, 900, 0, 10_000);
  return {
    concurrency: Math.min(8, Math.max(1, Math.trunc(overrides.concurrency ?? envConcurrency))),
    staggerMs: Math.min(10_000, Math.max(0, Math.trunc(overrides.staggerMs ?? envStaggerMs))),
  };
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Executes tasks with a hard in-flight cap and a minimum delay between task
 * starts. Results retain input order and use PromiseSettledResult so callers can
 * preserve existing interruption/error semantics without bursty Promise.all fan-out.
 */
export async function runScheduled<T>(tasks: ReadonlyArray<() => Promise<T>>, options: TaskSchedulerOptions = {}): Promise<Array<PromiseSettledResult<T>>> {
  if (!tasks.length) return [];
  const { concurrency, staggerMs } = resolveTaskSchedulerOptions(options);
  const sleep = options.sleep ?? defaultSleep;
  const results = new Array<PromiseSettledResult<T>>(tasks.length);
  const startedAt = Date.now();
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= tasks.length) return;
      if (staggerMs > 0 && index > 0) {
        const dueAt = startedAt + index * staggerMs;
        const delay = dueAt - Date.now();
        if (delay > 0) await sleep(delay);
      }
      try {
        results[index] = { status: 'fulfilled', value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}
