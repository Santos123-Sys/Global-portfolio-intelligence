export interface ModelRuntimeConfig {
  apiKey: string;
  baseUrl: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Shared transport boundary for Responses-compatible model providers.
 * Agent policy, prompts and schemas remain provider-agnostic above this layer.
 */
export function modelRuntimeConfig(): ModelRuntimeConfig {
  const apiKey = process.env.MODEL_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || '';
  const baseUrl = trimTrailingSlash(process.env.MODEL_API_BASE_URL?.trim() || process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1');
  return { apiKey, baseUrl };
}

export function hasModelRuntime(): boolean {
  return Boolean(modelRuntimeConfig().apiKey);
}

export async function requestModelResponse(payload: unknown, timeoutMs: number): Promise<Response> {
  const { apiKey, baseUrl } = modelRuntimeConfig();
  if (!apiKey) throw new Error('MODEL_API_KEY or OPENAI_API_KEY is required for the Analysis Swarm');
  return fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });
}
