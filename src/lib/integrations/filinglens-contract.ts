import { z } from 'zod';

// v1 is public regulator evidence only. Private uploads and valuation commands are excluded.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value =>
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const FilingLensIssuer = z.object({
  jurisdiction: z.enum(['us', 'br']),
  registryId: z.string().regex(/^\d{10}$|^\d{14}$/),
}).strict().superRefine((issuer, ctx) => {
  if (/^0+$/.test(issuer.registryId) || issuer.registryId.length !== (issuer.jurisdiction === 'us' ? 10 : 14))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Registry ID does not match jurisdiction' });
});
export type FilingLensIssuer = z.infer<typeof FilingLensIssuer>;
export const FilingLensFact = z.object({
  id: z.string().min(1).max(200),
  metric: z.string().min(1).max(100),
  value: z.string().regex(/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/).refine(value => Number.isFinite(Number(value))).nullable(),
  unit: z.string().min(1).max(100).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  fiscalYear: z.number().int().min(2000).max(2200),
  periodKind: z.literal('FY'),
  periodEnd: date.nullable(),
  periodLabel: z.string().max(150).nullable(),
  status: z.enum(['verified', 'single_source', 'conflicted', 'missing']),
  sources: z.array(z.object({
    url: z.string().url(), provider: z.string().min(1),
    form: z.string().nullable(), retrievedAt: z.string().nullable(),
  }).strict()).min(1).max(20),
}).strict().superRefine((fact, ctx) => {
  if ((fact.status === 'conflicted' || fact.status === 'missing') && fact.value !== null)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Conflicted/missing values must remain null' });
});
export const FilingLensSnapshot = z.object({
  schemaVersion: z.literal('filinglens-public-finance-v1'),
  snapshotId: z.string().regex(/^flpub1_[a-f0-9]{64}$/),
  contentHash: hash,
  archiveHash: hash,
  archivedOn: date,
  visibility: z.literal('public_regulatory'),
  issuer: FilingLensIssuer,
  provider: z.enum(['sec_edgar', 'cvm_open_data']),
  facts: z.array(FilingLensFact).min(1).max(1000),
  screening: z.object({
    revenueGrowthYoYPct: z.number().finite().nullable(),
    basis: z.literal('annual_same_currency_unit'),
    inputFactIds: z.array(z.string()).max(2),
    periodEnd: date.nullable(),
    calculatorVersion: z.literal('revenue-yoy-v1'),
  }).strict(),
  limitations: z.array(z.string()).max(20),
}).strict().superRefine((snapshot, ctx) => {
  const official = (url: string) => {
    let source: URL;
    try { source = new URL(url); } catch { return false; }
    return !source.username && !source.password && source.protocol === 'https:' && (snapshot.issuer.jurisdiction === 'us'
      ? source.hostname === 'sec.gov' || source.hostname.endsWith('.sec.gov')
      : ['dados.cvm.gov.br', 'www.gov.br', 'sistemas.cvm.gov.br'].includes(source.hostname));
  };
  if (snapshot.facts.some(fact => fact.sources.some(source => !official(source.url))))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only public regulator evidence is allowed' });
  if (snapshot.snapshotId !== 'flpub1_' + snapshot.archiveHash)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Snapshot/archive identity mismatch' });
  if (snapshot.provider !== (snapshot.issuer.jurisdiction === 'us' ? 'sec_edgar' : 'cvm_open_data'))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provider/jurisdiction mismatch' });
  const ids = new Set(snapshot.facts.map(fact => fact.id));
  if (ids.size !== snapshot.facts.length || snapshot.screening.inputFactIds.some(id => !ids.has(id)) ||
    new Set(snapshot.screening.inputFactIds).size !== snapshot.screening.inputFactIds.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid fact lineage' });
  if (snapshot.screening.revenueGrowthYoYPct !== null && snapshot.screening.inputFactIds.length !== 2)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Growth requires two source facts' });
});
export type FilingLensSnapshot = z.infer<typeof FilingLensSnapshot>;
export function snapshotContent(snapshot: FilingLensSnapshot): string {
  const { contentHash: _hash, ...payload } = snapshot;
  void _hash;
  return JSON.stringify(payload);
}
export function normalizeFilingLensIssuer(jurisdiction: string, registryId: string): FilingLensIssuer {
  if (jurisdiction !== 'us' && jurisdiction !== 'br') throw new Error('unsupported_market');
  if (!/^\d+$/.test(registryId) || /^0+$/.test(registryId)) throw new Error('invalid_registry_id');
  if (jurisdiction === 'us' && registryId.length > 10) throw new Error('invalid_registry_id');
  return FilingLensIssuer.parse({ jurisdiction, registryId: jurisdiction === 'us' ? registryId.padStart(10, '0') : registryId });
}
