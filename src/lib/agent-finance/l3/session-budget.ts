import { z } from 'zod';
import type { AnalyzeRequest } from '../contracts';
import type { ModelBudgetController, ModelUsage } from '../l2/model-budget-context';

const positiveInteger = z.coerce.number().int().positive();
const positiveNumber = z.coerce.number().positive();

export const sessionBudgetLimitsSchema = z.object({
  maxModelCalls: z.number().int().positive(),
  maxActiveMs: z.number().int().positive(),
  maxInputTokens: z.number().int().positive().nullable(),
  maxOutputTokens: z.number().int().positive().nullable(),
  maxEstimatedCostUsd: z.number().positive().nullable(),
}).strict();
export type SessionBudgetLimits = z.infer<typeof sessionBudgetLimitsSchema>;

export interface SessionBudgetUsage {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  unmeteredModelCalls: number;
  estimatedCostUsd: number | null;
  activeMs: number;
}

const defaultLimits: Record<AnalyzeRequest['analysisType'], Pick<SessionBudgetLimits, 'maxModelCalls' | 'maxActiveMs'>> = {
  dcf: { maxModelCalls: 16, maxActiveMs: 15 * 60_000 },
  quick: { maxModelCalls: 64, maxActiveMs: 15 * 60_000 },
  fundamental: { maxModelCalls: 112, maxActiveMs: 30 * 60_000 },
  combined: { maxModelCalls: 128, maxActiveMs: 45 * 60_000 },
};

function optionalInteger(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  return positiveInteger.parse(value);
}

function optionalNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  return positiveNumber.parse(value);
}

/** Hard safety ceilings. They are deliberately separate from performance SLOs. */
export function resolveSessionBudgetLimits(
  analysisType: AnalyzeRequest['analysisType'],
  env: NodeJS.ProcessEnv = process.env
): SessionBudgetLimits {
  const defaults = defaultLimits[analysisType];
  return sessionBudgetLimitsSchema.parse({
    maxModelCalls: optionalInteger(env.AGENT_SESSION_MAX_MODEL_CALLS) ?? defaults.maxModelCalls,
    maxActiveMs: optionalInteger(env.AGENT_SESSION_MAX_ACTIVE_MS) ?? defaults.maxActiveMs,
    maxInputTokens: optionalInteger(env.AGENT_SESSION_MAX_INPUT_TOKENS),
    maxOutputTokens: optionalInteger(env.AGENT_SESSION_MAX_OUTPUT_TOKENS),
    maxEstimatedCostUsd: optionalNumber(env.AGENT_SESSION_MAX_ESTIMATED_COST_USD),
  });
}

export class SessionBudgetExceededError extends Error {
  constructor(readonly dimension: 'model_calls' | 'active_time' | 'input_tokens' | 'output_tokens' | 'estimated_cost', detail?: string) {
    super(detail ?? `Session ${dimension.replaceAll('_', ' ')} budget exceeded`);
    this.name = 'SessionBudgetExceededError';
  }
}

export interface SessionBudgetOptions {
  limits: SessionBudgetLimits;
  usage?: Partial<SessionBudgetUsage>;
  now?: () => number;
  persist?: (usage: SessionBudgetUsage) => Promise<void>;
}

/**
 * One controller is shared by every parallel branch in a session. A tiny
 * promise lock makes reservations atomic without serialising the model calls.
 */
export class SessionBudget implements ModelBudgetController {
  readonly limits: SessionBudgetLimits;
  private readonly now: () => number;
  private readonly persist?: (usage: SessionBudgetUsage) => Promise<void>;
  private readonly attemptStartedAt: number;
  private baselineActiveMs: number;
  private state: SessionBudgetUsage;
  private lock: Promise<void> = Promise.resolve();

  constructor(options: SessionBudgetOptions) {
    this.limits = sessionBudgetLimitsSchema.parse(options.limits);
    this.now = options.now ?? Date.now;
    this.persist = options.persist;
    this.attemptStartedAt = this.now();
    this.baselineActiveMs = options.usage?.activeMs ?? 0;
    const modelCalls = options.usage?.modelCalls ?? 0;
    this.state = {
      modelCalls,
      inputTokens: options.usage?.inputTokens ?? 0,
      outputTokens: options.usage?.outputTokens ?? 0,
      unmeteredModelCalls: options.usage?.unmeteredModelCalls ?? 0,
      // Zero calls means zero known cost. Once any call lacks an exact price,
      // null is sticky so a partial subtotal can never masquerade as a total.
      estimatedCostUsd: options.usage?.estimatedCostUsd ?? (modelCalls === 0 ? 0 : null),
      activeMs: this.baselineActiveMs,
    };
  }

  snapshot(): SessionBudgetUsage {
    return { ...this.state, activeMs: this.currentActiveMs() };
  }

  private currentActiveMs(): number {
    return this.baselineActiveMs + Math.max(0, this.now() - this.attemptStartedAt);
  }

  private runLocked(work: () => Promise<void>): Promise<void> {
    const next = this.lock.then(work, work);
    this.lock = next.catch(() => undefined);
    return next;
  }

  private assertWithinLimits(usage: SessionBudgetUsage): void {
    if (usage.modelCalls > this.limits.maxModelCalls) throw new SessionBudgetExceededError('model_calls');
    if (usage.activeMs > this.limits.maxActiveMs) throw new SessionBudgetExceededError('active_time');
    if (this.limits.maxInputTokens !== null && usage.inputTokens > this.limits.maxInputTokens) throw new SessionBudgetExceededError('input_tokens');
    if (this.limits.maxOutputTokens !== null && usage.outputTokens > this.limits.maxOutputTokens) throw new SessionBudgetExceededError('output_tokens');
    if (this.limits.maxEstimatedCostUsd !== null) {
      if (usage.modelCalls > 0 && usage.estimatedCostUsd === null) {
        throw new SessionBudgetExceededError('estimated_cost', 'Session estimated cost budget cannot be enforced because a model call was unpriced');
      }
      if (usage.estimatedCostUsd !== null && usage.estimatedCostUsd > this.limits.maxEstimatedCostUsd) throw new SessionBudgetExceededError('estimated_cost');
    }
  }

  private async save(): Promise<void> {
    this.state.activeMs = this.currentActiveMs();
    await this.persist?.({ ...this.state });
  }

  async beforeRequest(requestedTimeoutMs: number): Promise<number> {
    let allowedTimeoutMs = requestedTimeoutMs;
    await this.runLocked(async () => {
      const candidate = this.snapshot();
      candidate.modelCalls += 1;
      this.assertWithinLimits(candidate);
      this.state = candidate;
      await this.save();
      allowedTimeoutMs = Math.max(1, Math.min(requestedTimeoutMs, this.limits.maxActiveMs - this.state.activeMs));
    });
    return allowedTimeoutMs;
  }

  async afterResponse(usage: ModelUsage): Promise<void> {
    await this.runLocked(async () => {
      this.state.inputTokens += usage.inputTokens ?? 0;
      this.state.outputTokens += usage.outputTokens ?? 0;
      if (usage.inputTokens === null || usage.outputTokens === null) this.state.unmeteredModelCalls += 1;
      if (usage.estimatedCostUsd === null) this.state.estimatedCostUsd = null;
      else if (this.state.estimatedCostUsd !== null) this.state.estimatedCostUsd += usage.estimatedCostUsd;
      this.state.activeMs = this.currentActiveMs();
      await this.save();
      this.assertWithinLimits(this.state);
    });
  }

  async flush(): Promise<SessionBudgetUsage> {
    await this.runLocked(async () => {
      await this.save();
      this.assertWithinLimits(this.state);
    });
    return this.snapshot();
  }
}
