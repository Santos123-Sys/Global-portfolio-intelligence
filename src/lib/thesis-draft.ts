import { z } from 'zod';
import {
  ThesisCriteria,
  ThesisPortfolioCriteria,
  ThesisPolicy,
  ThesisRule,
} from '@portfolio-intelligence/agentic-contract';
// Drafts deliberately allow incomplete text. Approval still uses the strict contract.
const draftRule = ThesisRule.extend({
  statement: z.string(),
  metric: z
    .object({
      field: z.string(),
      operator: z.enum(['gte', 'lte']),
      value: z
        .number()
        .nullable()
        .transform((v) => v ?? NaN),
      unit: z.string(),
      period: z.string(),
    })
    .optional(),
});
const draftPolicy = ThesisPolicy.extend({
  name: z.string().optional(),
  strategy: z.string().optional(),
  benchmark: z.string().optional(),
  horizon: z.string().optional(),
  targetHoldings: z.number().optional(),
  maximumHoldings: z.number().optional(),
  universe: z.object({
    domicileCountries: z.array(z.string()),
    listingMarkets: z.array(z.string()),
    operatingCountries: z.array(z.string()),
    revenueCountries: z.array(z.string()),
    securityTypes: z.array(z.string()),
    sectorsIncluded: z.array(z.string()),
    sectorsExcluded: z.array(z.string()),
    industriesIncluded: z.array(z.string()),
    industriesExcluded: z.array(z.string()),
  }),
  rules: z.array(draftRule),
});
export const ThesisDraft = z
  .object({
    schemaVersion: z.literal(1),
    criteria: ThesisCriteria.extend({
      portfolios: z
        .array(
          ThesisPortfolioCriteria.extend({
            role: z.string(),
            currency: z.string(),
            objective: z.string(),
            policy: draftPolicy.optional(),
          }),
        )
        .min(1),
    }),
    selectedId: z.string().nullable(),
    manual: z.boolean().default(false),
    baseVersionId: z.string().uuid().nullable(),
    reviewNotes: z.string(),
  })
  .strict();
