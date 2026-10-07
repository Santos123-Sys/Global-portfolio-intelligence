import { describe, expect, it, vi } from 'vitest';
import { loadFinanceRuntime, type FinanceRuntime } from '../src/finance-startup.js';

const databaseUrl = 'postgresql://finance:finance@localhost:5432/finance';

describe('canonical runtime startup', () => {
  it('preserves local preparatory-only mode without importing the runtime', async () => {
    const load = vi.fn();
    const env = { DATABASE_URL: 'local-original' };
    expect(await loadFinanceRuntime(undefined, load, env)).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(env.DATABASE_URL).toBe('local-original');
  });

  it('sets the finance database before import and waits for readiness', async () => {
    const env = { AGENTIC_DATABASE_URL: 'preparatory-database' } as NodeJS.ProcessEnv;
    let finish!: () => void;
    const initialized = new Promise<void>(resolve => { finish = resolve; });
    const runtime: FinanceRuntime = {
      initializeFinanceRuntime: vi.fn(() => initialized),
      processQueuedSessions: vi.fn(async () => 0),
    };
    const load = vi.fn(async () => {
      expect(env.DATABASE_URL).toBe(databaseUrl);
      return runtime;
    });
    let ready = false;
    const startup = loadFinanceRuntime(databaseUrl, load, env).then(value => {
      ready = true;
      return value;
    });
    await vi.waitFor(() => expect(runtime.initializeFinanceRuntime).toHaveBeenCalledOnce());
    expect(ready).toBe(false);
    expect(runtime.processQueuedSessions).not.toHaveBeenCalled();
    expect(env.AGENTIC_DATABASE_URL).toBe('preparatory-database');
    finish();
    expect(await startup).toBe(runtime);
  });

  it('propagates import and database-readiness failures to the worker failure handler', async () => {
    await expect(loadFinanceRuntime(databaseUrl, async () => {
      throw new Error('Bundle missing');
    }, {})).rejects.toThrow('Bundle missing');
    const runtime: FinanceRuntime = {
      initializeFinanceRuntime: vi.fn(async () => { throw new Error('Queue table missing'); }),
      processQueuedSessions: vi.fn(async () => 0),
    };
    await expect(loadFinanceRuntime(databaseUrl, async () => runtime, {}))
      .rejects.toThrow('Queue table missing');
    expect(runtime.processQueuedSessions).not.toHaveBeenCalled();
  });
});
