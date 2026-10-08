import { AsyncLocalStorage } from 'node:async_hooks';

export interface ModelUsage {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
}

export interface ModelBudgetController {
  beforeRequest(requestedTimeoutMs: number): Promise<number>;
  afterResponse(usage: ModelUsage): Promise<void>;
}

const storage = new AsyncLocalStorage<ModelBudgetController>();

export function withModelBudget<T>(controller: ModelBudgetController, work: () => Promise<T>): Promise<T> {
  return storage.run(controller, work);
}

export async function reserveModelRequest(requestedTimeoutMs: number): Promise<number> {
  const controller = storage.getStore();
  return controller ? controller.beforeRequest(requestedTimeoutMs) : requestedTimeoutMs;
}

export async function recordModelUsage(usage: ModelUsage): Promise<void> {
  await storage.getStore()?.afterResponse(usage);
}
