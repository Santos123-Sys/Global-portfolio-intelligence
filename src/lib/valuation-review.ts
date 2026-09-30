import { MarketValuationReview } from '@portfolio-intelligence/agentic-contract';
import { z } from 'zod';
import { isSupportedFiscalDate } from './financial-evidence';
import { COMPANY_LIFE_CYCLE_STAGES } from './company-life-cycle';
const scenario = z.object({
  annualGrowthRate: z.number().finite().min(-0.5).max(0.5),
  discountRate: z.number().finite().positive().max(0.5),
  terminalGrowthRate: z.number().finite().min(-0.05).max(0.05),
  rationale: z.string().trim().min(10).max(1200),
}).strict().refine(value => value.discountRate > value.terminalGrowthRate, 'WACC must exceed terminal growth');
export const valuationReviewSchema = z.object({
  market: MarketValuationReview.optional(),
  confirmed: z.literal(true),
  financialPeriodEnd: z.string().refine(value => isSupportedFiscalDate(value)),
  currency: z.string().regex(/^[A-Z]{3}$/),
  asOf: z.string().refine(value => isSupportedFiscalDate(value), 'Review date must be a valid nonfuture date'),
  sourceUrl: z.string().url().refine(value => /^https?:\/\//.test(value), 'Use an HTTP(S) source'),
  rationale: z.string().trim().min(20).max(4000),
  lifeCycle: z.object({
    stage: z.enum(COMPANY_LIFE_CYCLE_STAGES),
    rationale: z.string().trim().min(20).max(2000),
  }).strict(),
  fcff: z.object({
    method: z.enum(['auto', 'ebit', 'cfo']),
    taxRate: z.number().finite().min(0).max(1).optional(),
    workingCapitalInvestment: z.number().finite().optional(),
    interestIncludedInCfo: z.boolean(),
  }).strict(),
  scenarios: z.object({ worst_case: scenario, base_case: scenario, optimistic_case: scenario }).strict(),
}).strict();
export type ValuationReview = z.infer<typeof valuationReviewSchema>;
