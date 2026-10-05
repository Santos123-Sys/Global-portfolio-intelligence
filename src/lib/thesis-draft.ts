import { z } from 'zod';
import {
  ThesisCriteria,
  ThesisPortfolioCriteria,
  ThesisPolicy,
} from '@portfolio-intelligence/agentic-contract';

// Drafts deliberately allow incomplete text and predicate fields. Approval still
// uses the strict/refined agentic contract, so a partially edited rule cannot
// become canonical merely because it can be recovered from session storage.
const draftMetric = z.object({
  field: z.string(),
  operator: z.enum(['gte', 'lte']),
  value: z.number().nullable().transform((v) => v ?? NaN),
  unit: z.string(),
  period: z.string(),
}).optional();

const draftPredicate = z.object({
  mode: z.enum(['attribute', 'evidence']),
  field: z.string(),
  operator: z.enum(['eq', 'neq']),
  value: z.string(),
  sourceRequirement: z.enum(['provider', 'official']).optional(),
  maxAgeDays: z.number().optional(),
}).optional();

const draftRule = z.object({
  statement: z.string(),
  kind: z.enum(['hard', 'preference', 'context']),
  category: z.enum(['selection', 'macro', 'sector', 'risk', 'valuation']),
  metric: draftMetric,
  predicate: draftPredicate,
}).strict();

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
