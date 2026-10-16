import { z } from 'zod';

/** Evidence URLs never carry service credentials, signed access queries or userinfo into the browser. */
export function safeLineageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      ![...url.searchParams.keys()].some(key => /token|secret|password|signature|api.?key/i.test(key));
  } catch { return false; }
}
const text = z.string().max(3000);
const source = z.object({
  section: text, page: text.nullable().optional(), item: text.nullable().optional(),
  sourceForm: text.nullable().optional(), quote: z.string().max(25000).nullable().optional(),
  kind: z.enum(['excerpt', 'citation']).optional(),
  url: z.string().max(2048).refine(safeLineageUrl).optional(),
  publisher: text.optional(), accessed: z.string().max(100).optional(),
}).strict();
const node = z.object({
  id: z.string().min(1).max(160), label: z.string().max(500),
  value: z.union([z.number().finite(), z.string().max(3000), z.null()]),
  unit: z.string().max(150), period: z.string().max(150),
  classification: z.enum(['reported_actual', 'normalized_actual', 'user_assumption', 'calculated_metric', 'calculated_forecast']),
  status: z.enum(['source_linked', 'user_supplied', 'unverified', 'conflicting_evidence', 'calculated']),
  formula: text.optional(), inputs: z.array(z.string().min(1).max(160)).max(150),
  sources: z.array(source).max(40), retrievalMethod: text,
  checks: z.array(text).max(30), limitations: z.array(text).max(40),
}).strict();
export const FinancialLineage = z.object({
  schemaVersion: z.literal('financial-lineage.v1'),
  issuer: z.object({name: z.string().max(500), ticker: z.string().max(30).nullable(), registryId: z.string().max(30).nullable()}).strict(),
  accountingBasis: z.string().max(100), scope: z.string().max(100),
  calculationVersion: z.string().max(150), valuationDate: z.string().max(100).nullable(),
  nodes: z.record(z.string().min(1).max(160), node),
}).strict().superRefine((graph, context) => {
  const entries = Object.entries(graph.nodes);
  if (!entries.length || entries.length > 500) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Invalid lineage graph size'});
    return;
  }
  for (const [id, item] of entries) {
    if (id !== item.id || item.inputs.some(input => !Object.hasOwn(graph.nodes, input)))
      context.addIssue({code: z.ZodIssueCode.custom, message: 'Invalid lineage dependency'});
  }
  // Reject cycles before a client can recursively navigate or export them as an input tree.
  const completed = new Set<string>(), active = new Set<string>();
  const visit = (id: string): boolean => {
    if (active.has(id)) return false;
    if (completed.has(id)) return true;
    active.add(id);
    for (const input of graph.nodes[id]?.inputs ?? []) if (!visit(input)) return false;
    active.delete(id); completed.add(id); return true;
  };
  if (entries.some(([id]) => !visit(id)))
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Cyclic lineage graph'});
});
export const ValuationAudit = z.object({
  schemaVersion: z.literal('valuation-audit.v1'),
  valuationVersionId: z.string().regex(/^flv1_[a-f0-9]{64}$/),
  issuerId: z.string().regex(/^(us:\d{10}|br:\d{14})$/),
  lineage: FinancialLineage,
}).strict();
export type ValuationAudit = z.infer<typeof ValuationAudit>;
export type FinancialLineage = z.infer<typeof FinancialLineage>;
export type LineageNode = FinancialLineage['nodes'][string];
