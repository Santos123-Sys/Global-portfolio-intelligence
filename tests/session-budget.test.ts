import { describe, expect, it, vi } from 'vitest';
import {
  resolveSessionBudgetLimits,
  SessionBudget,
} from '../src/lib/agent-finance/l3/session-budget';

const limits = {
  maxModelCalls: 2,
  maxActiveMs: 10_000,
  maxInputTokens: 100,
  maxOutputTokens: 50,
  maxEstimatedCostUsd: 1,
};

describe('aggregate research-session budget', () => {
  it('atomically reserves calls across parallel branches', async () => {
    const budget = new SessionBudget({ limits });
    await Promise.all([budget.beforeRequest(5_000), budget.beforeRequest(5_000)]);
    await expect(budget.beforeRequest(5_000)).rejects.toMatchObject({
      dimension: 'model_calls',
    });
    expect(budget.snapshot().modelCalls).toBe(2);
  });

  it('bounds each request by the remaining active-time budget', async () => {
    let now = 1_000;
    const budget = new SessionBudget({ limits, now: () => now });
    now += 8_500;
    expect(await budget.beforeRequest(8_000)).toBe(1_500);
    now += 1_501;
    await expect(budget.beforeRequest(500)).rejects.toMatchObject({ dimension: 'active_time' });
  });

  it('also enforces active time when work reaches a completion checkpoint without another call', async () => {
    let now = 1_000;
    const budget = new SessionBudget({ limits, now: () => now });
    now += 10_001;
    await expect(budget.flush()).rejects.toMatchObject({ dimension: 'active_time' });
  });

  it('persists usage and stops once a response crosses a token ceiling', async () => {
    const persist = vi.fn(async () => undefined);
    const budget = new SessionBudget({ limits, persist });
    await budget.beforeRequest(5_000);
    await expect(budget.afterResponse({ model: 'test', inputTokens: 101, outputTokens: 5, estimatedCostUsd: 0.1 }))
      .rejects.toMatchObject({ dimension: 'input_tokens' });
    expect(persist).toHaveBeenCalled();
    expect(budget.snapshot()).toMatchObject({ inputTokens: 101, outputTokens: 5, estimatedCostUsd: 0.1 });
  });

  it('makes missing provider usage visible instead of treating it as zero evidence', async () => {
    const budget = new SessionBudget({ limits: { ...limits, maxEstimatedCostUsd: null } });
    await budget.beforeRequest(5_000);
    await budget.afterResponse({ model: 'test', inputTokens: null, outputTokens: null, estimatedCostUsd: null });
    expect(budget.snapshot().unmeteredModelCalls).toBe(1);
    expect(budget.snapshot().estimatedCostUsd).toBeNull();
  });

  it('uses analysis-specific defaults and accepts operator hard ceilings', () => {
    expect(resolveSessionBudgetLimits('combined', { NODE_ENV: 'test' })).toMatchObject({ maxModelCalls: 128, maxActiveMs: 45 * 60_000 });
    expect(resolveSessionBudgetLimits('quick', {
      NODE_ENV: 'test',
      AGENT_SESSION_MAX_MODEL_CALLS: '20',
      AGENT_SESSION_MAX_ACTIVE_MS: '120000',
      AGENT_SESSION_MAX_ESTIMATED_COST_USD: '4.5',
    })).toMatchObject({ maxModelCalls: 20, maxActiveMs: 120_000, maxEstimatedCostUsd: 4.5 });
  });

  it('fails closed when a configured cost ceiling cannot be measured', async () => {
    const budget = new SessionBudget({ limits: { ...limits, maxEstimatedCostUsd: 0.5 } });
    await budget.beforeRequest(5_000);
    await expect(budget.afterResponse({ model: 'unpriced', inputTokens: 10, outputTokens: 5, estimatedCostUsd: null }))
      .rejects.toThrow(/cannot be enforced/);
  });
});
