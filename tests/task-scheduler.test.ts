import { describe, expect, it, vi } from 'vitest';
import { resolveTaskSchedulerOptions, runScheduled } from '../src/lib/agent-finance/l3/task-scheduler';

describe('agent task scheduler', () => {
  it('uses conservative bounded defaults and accepts explicit overrides', () => {
    vi.stubEnv('AGENT_MAX_CONCURRENCY', '99');
    vi.stubEnv('AGENT_STAGGER_MS', '-2');
    expect(resolveTaskSchedulerOptions()).toEqual({ concurrency: 8, staggerMs: 0 });
    expect(resolveTaskSchedulerOptions({ concurrency: 2, staggerMs: 1250 })).toEqual({ concurrency: 2, staggerMs: 1250 });
    vi.unstubAllEnvs();
  });

  it('caps the number of in-flight tasks and preserves result ordering', async () => {
    let active = 0;
    let maximumActive = 0;
    const tasks = Array.from({ length: 6 }, (_, index) => async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 4));
      active -= 1;
      return index;
    });
    const results = await runScheduled(tasks, { concurrency: 2, staggerMs: 0 });
    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(results.map(result => result.status === 'fulfilled' ? result.value : null)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('settles failures instead of aborting sibling work', async () => {
    const results = await runScheduled([
      async () => 'first',
      async () => { throw new Error('provider failure'); },
      async () => 'third',
    ], { concurrency: 2, staggerMs: 0 });
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});
