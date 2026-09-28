import { z } from 'zod';

export const weightConfigSchema = z.object({
  objective: z.enum(['balanced', 'max_sharpe', 'min_vol', 'max_growth']).default('balanced'),
  rf: z.number().finite().min(-0.1).max(0.5).default(0.02),
  max_drawdown: z.number().finite().positive().max(1).nullable().default(null),
  est_window: z.number().int().min(60).max(1260).default(756),
  step: z.number().int().min(21).max(252).default(126),
  cost: z.number().finite().min(0).max(0.02).default(0.001),
  n_boot: z.number().int().min(10).max(100).default(60),
  seed: z.number().int().min(0).max(2147483647).default(0),
  per_asset_max: z.number().finite().positive().max(1).default(0.60),
}).strict();
export type WeightConfig = z.infer<typeof weightConfigSchema>;
const weights = z.record(z.number().finite().min(0).max(1));
const metrics = z.object({ cagr: z.number().finite(), vol: z.number().finite(), sharpe: z.number().finite(),
  max_drawdown: z.number().finite(), ann_turnover: z.number().finite() });
const stability = z.object({ mad_from_base: z.number().finite(), cross_run_std: z.number().finite() });
export const weightResultSchema = z.object({
  engine_version: z.literal('portfolio-weights/1.0.0'),
  dependencies: z.record(z.string()), inputs: z.record(z.unknown()),
  data_range: z.object({ start: z.string(), end: z.string(), rows: z.number().int() }),
  weights_table: z.record(weights), oos_summary: z.record(metrics), stability: z.record(stability),
  recommendation: z.object({ recommended_method: z.string(), recommended_weights: weights,
    stability_flag: z.string().nullable(), constraint_flag: z.string().nullable(), user_must_choose: z.literal(true),
    ranking: z.record(metrics.merge(stability).extend({ score: z.number().finite(), eligible: z.boolean(), vol_inv: z.number().finite() })),
  }),
});
export type WeightResult = z.infer<typeof weightResultSchema>;
export const finalWeightsSchema = z.object({ final_weights: weights, source: z.string(), was_user_decision: z.literal(true),
  audit: z.object({ recommended_method: z.string(), user_choice: z.union([z.string(), z.record(z.number().finite())]),
    stability_flag: z.string().nullable(), constraint_flag: z.string().nullable() }) });
export type FinalWeights = z.infer<typeof finalWeightsSchema>;
export const computeWeightsSchema = z.object({ portfolioId: z.string().uuid(), pricesCsv: z.string().min(20).max(2_000_000),
  source: z.string().trim().min(3).max(300), totalReturnConfirmed: z.literal(true),
  currency: z.string().regex(/^[A-Z]{3}$/), config: weightConfigSchema.default({}),
}).strict();
export const confirmWeightsSchema = z.object({ portfolioId: z.string().uuid(), runId: z.string().uuid(),
  userChoice: z.union([z.string().min(1), z.record(z.number().finite().nonnegative())]),
  confirm: z.literal(true), warningsAcknowledged: z.boolean(),
}).strict();

export function validateWeightVector(vector: Record<string, number>, assets: string[], cap: number) {
  if (Object.keys(vector).sort().join('|') !== [...assets].sort().join('|') ||
      Object.values(vector).some(v => !Number.isFinite(v) || v < 0 || v > cap + 1e-7) ||
      Math.abs(Object.values(vector).reduce((a, b) => a + b, 0) - 1) > 1e-6) {
    throw new Error('Invalid allocation vector or asset cap');
  }
}

export function decisionWarnings(result: WeightResult, choice: string | Record<string, number>): string[] {
  const rec = result.recommendation;
  const warnings = [rec.stability_flag, rec.constraint_flag].filter((s): s is string => Boolean(s));
  if (typeof choice === 'object') warnings.push('Custom weights have not been backtested or stability-tested.');
  else {
    const name = choice === 'recommendation' ? rec.recommended_method : choice;
    const row = rec.ranking[name];
    if (!row) throw new Error('Choose a method in the stored ranking');
    if (!row.eligible) warnings.push('Chosen method breaches the requested historical drawdown limit.');
    if (row.mad_from_base > 0.08) warnings.push('Chosen method is sensitive to input changes.');
  }
  return [...new Set(warnings)];
}
