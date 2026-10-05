import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasModelRuntime, modelRuntimeConfig, requestModelResponse } from '../src/lib/agent-finance/l2/model-runtime';

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
});
