import { z } from 'zod';
import { FilingLensIssuer } from '../integrations/filinglens-contract';
export const Market = z.enum(['us', 'br']);
export const Candidate = z.object({
  key: z.string().regex(/^[A-Z0-9.:-]{1,60}$/), name: z.string().trim().min(1).max(160),
  ticker: z.string().regex(/^[A-Z0-9.-]{1,20}$/), exchange: z.enum(['XNAS', 'XNYS', 'ARCX', 'XASE', 'BVMF']), market: Market,
  issuer: FilingLensIssuer.nullable(), identitySourceUrl: z.string().url().max(2048),
}).strict().superRefine((c, ctx) => {
  if ((c.exchange === 'BVMF' ? 'br' : 'us') !== c.market || (c.issuer && c.issuer.jurisdiction !== c.market))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Exchange and issuer must match market' });
  if (c.key !== `${c.exchange}:${c.ticker}`) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Listing key must match exchange/ticker' });
  try { const u = new URL(c.identitySourceUrl); if (u.protocol !== 'https:' || u.username || u.password) throw new Error(); }
  catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'HTTPS identity source required' }); }
});
export type Candidate = z.infer<typeof Candidate>;
export const Profile = z.object({
  name: z.string().trim().min(1).max(100), objective: z.enum(['growth', 'income', 'preservation']),
  markets: z.array(Market).min(1).max(2).refine(values => new Set(values).size === values.length),
  minimumRevenueGrowthPct: z.number().finite().min(-100).max(1000).nullable(),
  minimumAverageDailyShares: z.number().finite().nonnegative().max(1e12).nullable(),
  maxEvidenceAgeDays: z.number().int().min(30).max(730),
}).strict();
export type Profile = z.infer<typeof Profile>;
export const defaultProfile: Profile = { name: 'Foundational growth screen', objective: 'growth', markets: ['us', 'br'], minimumRevenueGrowthPct: 10, minimumAverageDailyShares: null, maxEvidenceAgeDays: 550 };
export const Workspace = z.object({ version: z.literal(1), profile: Profile, candidates: z.array(Candidate).max(100)
  .refine(items => new Set(items.map(c => c.key)).size === items.length, 'Duplicate listing keys') }).strict();
export type Workspace = z.infer<typeof Workspace>;
export const JobRequest = z.object({ kind: z.enum(['screen', 'research']), candidateKey: z.string().max(60).optional(),
  idempotencyKey: z.string().uuid(), workspace: Workspace }).strict().superRefine((j, ctx) => {
  if (j.kind === 'screen' && (!j.workspace.candidates.length || j.workspace.candidates.length > 20))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Screen batches require one to twenty candidates' });
  if (j.kind === 'research' && !j.workspace.candidates.some(c => c.key === j.candidateKey))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Research requires a candidate in the workspace' });
});
export type JobRequest = z.infer<typeof JobRequest>;
export type Decision = { stage: string; status: 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_REQUESTED'; reason: string; evidenceIds: string[] };
