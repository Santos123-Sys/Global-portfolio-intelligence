import { z } from 'zod';

const text = z.string().trim().min(1).max(2000);
const list = z.array(text).max(100);
export const ValueScorecardPolicy = z.object({
  enabled: z.boolean(),
  weights: z.object({moat:z.number().min(0).max(1),management:z.number().min(0).max(1),financials:z.number().min(0).max(1),valuation:z.number().min(0).max(1)}).strict()
    .refine(value=>Math.abs(Object.values(value).reduce((sum,weight)=>sum+weight,0)-1)<.0001,'Scorecard weights must sum to 1'),
  minimumEvidenceCoverage: z.number().min(.5).max(1).default(.8),
}).strict();

/**
 * Non-numeric predicates are explicit, source-verifiable facts. Attribute mode
 * uses provider/security-master fields; evidence mode additionally requires
 * source lineage and can enforce freshness. The system never invents a
 * predicate from prose.
 */
export const ThesisPredicate = z.object({
  mode: z.enum(['attribute', 'evidence']),
  field: text,
  operator: z.enum(['eq', 'neq']),
  value: text,
  sourceRequirement: z.enum(['provider', 'official']).optional(),
  maxAgeDays: z.number().int().positive().max(3650).optional(),
}).strict().superRefine((predicate, context) => {
  if (predicate.mode === 'evidence' && !predicate.sourceRequirement) {
    context.addIssue({ code: 'custom', path: ['sourceRequirement'], message: 'Evidence predicates require a source requirement' });
  }
  if (predicate.mode === 'attribute' && (predicate.sourceRequirement || predicate.maxAgeDays)) {
    context.addIssue({ code: 'custom', path: ['mode'], message: 'Attribute predicates cannot declare evidence-source requirements' });
  }
});

export const ThesisRule = z
  .object({
    statement: text,
    kind: z.enum(['hard', 'preference', 'context']),
    category: z.enum(['selection', 'macro', 'sector', 'risk', 'valuation']),
    // A numeric predicate is supplied by the investor, never inferred from qualitative prose.
    metric: z
      .object({
        field: text,
        operator: z.enum(['gte', 'lte']),
        value: z.number().finite(),
        unit: text,
        period: text,
      })
      .strict()
      .optional(),
    // Explicit categorical/evidence predicate for facts such as legal status.
    predicate: ThesisPredicate.optional(),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.metric && rule.predicate) context.addIssue({ code: 'custom', path: ['predicate'], message: 'Use either a numeric metric or a categorical/evidence predicate, not both' });
    if (rule.kind !== 'hard' && rule.predicate?.mode === 'evidence') context.addIssue({ code: 'custom', path: ['predicate'], message: 'Evidence-gated eligibility predicates are reserved for hard rules' });
  });
export const ThesisPolicy = z
  .object({
    name: text.optional(),
    strategy: text.optional(),
    benchmark: text.optional(),
    horizon: text.optional(),
    targetHoldings: z.number().int().positive().max(1000).optional(),
    maximumHoldings: z.number().int().positive().max(1000).optional(),
    research: z.object({locale:z.enum(['pt-BR','en','de','es']).default('en'),valueScorecard:ValueScorecardPolicy.optional()}).strict().optional(),
    universe: z
      .object({
        // Country fields use ISO alpha-2; listing markets use MICs. Empty means unrestricted.
        domicileCountries: list,
        listingMarkets: list,
        operatingCountries: list,
        revenueCountries: list,
        securityTypes: list,
        sectorsIncluded: list,
        sectorsExcluded: list,
        industriesIncluded: list,
        industriesExcluded: list,
      })
      .strict(),
    rules: z.array(ThesisRule).max(100),
  })
  .strict();
export type ThesisPolicy = z.infer<typeof ThesisPolicy>;
export type ThesisRule = z.infer<typeof ThesisRule>;
export type ThesisPredicate = z.infer<typeof ThesisPredicate>;

export function emptyThesisPolicy(): ThesisPolicy {
  return {
    universe: {
      domicileCountries: [],
      listingMarkets: [],
      operatingCountries: [],
      revenueCountries: [],
      securityTypes: [],
      sectorsIncluded: [],
      sectorsExcluded: [],
      industriesIncluded: [],
      industriesExcluded: [],
    },
    rules: [],
  };
}
