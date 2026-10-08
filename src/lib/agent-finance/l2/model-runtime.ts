import { estimateModelCost } from './model-pricing';
import { recordModelUsage, reserveModelRequest } from './model-budget-context';

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
  const model = typeof payload === 'object' && payload !== null && typeof (payload as {model?:unknown}).model === 'string'
    ? (payload as {model:string}).model
    : 'unknown';
  const boundedTimeoutMs = await reserveModelRequest(timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(boundedTimeoutMs),
      cache: 'no-store',
    });
  } catch (error) {
    await recordModelUsage({model,inputTokens:null,outputTokens:null,estimatedCostUsd:null});
    throw error;
  }
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  if (response.ok) {
    try {
      const body = await response.clone().json() as {usage?:{input_tokens?:number;output_tokens?:number}};
      inputTokens = body.usage?.input_tokens ?? null;
      outputTokens = body.usage?.output_tokens ?? null;
    } catch {
      // The caller still owns response parsing. Missing usage remains visible
      // as an unmetered call instead of silently becoming zero tokens.
    }
  }
  await recordModelUsage({model,inputTokens,outputTokens,estimatedCostUsd:estimateModelCost(model,inputTokens,outputTokens)});
  return response;
}
