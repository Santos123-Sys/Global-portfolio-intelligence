import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasModelRuntime, modelRuntimeConfig, requestModelResponse } from '../src/lib/agent-finance/l2/model-runtime';
import { withModelBudget, type ModelBudgetController } from '../src/lib/agent-finance/l2/model-budget-context';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('model runtime transport', () => {
  it('falls back to the existing OpenAI credentials and endpoint', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    expect(modelRuntimeConfig()).toEqual({ apiKey: 'openai-key', baseUrl: 'https://api.openai.com/v1' });
    expect(hasModelRuntime()).toBe(true);
  });

  it('supports a Responses-compatible commercial provider without changing agent policy', async () => {
    vi.stubEnv('MODEL_API_KEY', 'provider-key');
    vi.stubEnv('MODEL_API_BASE_URL', 'https://models.example/v1/');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await requestModelResponse({ model: 'research-model' }, 5000);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://models.example/v1/responses');
    expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer provider-key');
  });

  it('accounts for every provider call at the shared transport boundary', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('AGENT_MODEL_PRICING_JSON', JSON.stringify({ metered: { input: 2, output: 8 } }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      usage: { input_tokens: 100, output_tokens: 50 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const controller: ModelBudgetController = {
      beforeRequest: vi.fn(async () => 1_250),
      afterResponse: vi.fn(async () => undefined),
    };
    await withModelBudget(controller, () => requestModelResponse({ model: 'metered' }, 5_000));
    expect(controller.beforeRequest).toHaveBeenCalledWith(5_000);
    expect(controller.afterResponse).toHaveBeenCalledWith({
      model: 'metered', inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.0006,
    });
  });
});
