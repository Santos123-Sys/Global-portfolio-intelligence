import { z } from 'zod';

const text = z.string().trim().min(1).max(2000);
const list = z.array(text).max(100);
export const ThesisRule = z
  .object({
    statement: text,
    kind: z.enum(['hard', 'preference', 'context']),
    category: z.enum(['selection', 'macro', 'sector', 'risk', 'valuation']),
    // A predicate is supplied by the investor, never inferred from qualitative prose.
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
  })
  .strict();
export const ThesisPolicy = z
  .object({
    name: text.optional(),
    strategy: text.optional(),
    benchmark: text.optional(),
    horizon: text.optional(),
    targetHoldings: z.number().int().positive().max(1000).optional(),
    maximumHoldings: z.number().int().positive().max(1000).optional(),
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
