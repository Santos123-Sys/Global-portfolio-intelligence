import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getEnv: vi.fn(), execute: vi.fn() }));
vi.mock('@/lib/env', () => ({ getEnv: mocks.getEnv }));
vi.mock('@/lib/db', () => ({ db: { execute: mocks.execute } }));
import { initializeFinanceRuntime } from '@/lib/agent-finance/startup';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.execute.mockResolvedValue([]);
});

describe('finance queue readiness', () => {
  it('validates runtime configuration and probes both queues without loading or mutating records', async () => {
    await initializeFinanceRuntime();
    expect(mocks.getEnv).toHaveBeenCalledOnce();
    expect(mocks.getEnv.mock.invocationCallOrder[0]).toBeLessThan(mocks.execute.mock.invocationCallOrder[0]);
    const dialect = new PgDialect();
    expect(mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query).sql)).toEqual([
      'select 1 from "agent_analysis_sessions" limit 0',
      'select 1 from "agent_evaluation_jobs" limit 0',
    ]);
  });

  it('refuses readiness before database access when runtime settings are invalid', async () => {
    mocks.getEnv.mockImplementation(() => { throw new Error('Invalid runtime configuration'); });
    await expect(initializeFinanceRuntime()).rejects.toThrow('Invalid runtime configuration');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('refuses readiness if either queue cannot be read', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('Database unreachable'));
    await expect(initializeFinanceRuntime()).rejects.toThrow('Database unreachable');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    mocks.execute.mockReset().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Evaluation schema missing'));
    await expect(initializeFinanceRuntime()).rejects.toThrow('Evaluation schema missing');
  });
});
