import {z} from 'zod';
export const WorkspaceOverview=z.object({
 version:z.literal('investment-workspace.v1'),candidateKey:z.string(),issuerId:z.string().nullable(),financialOrigin:z.string().url().nullable(),checkedAt:z.string().datetime(),
 documents:z.object({status:z.enum(['verified','empty','blocked','unavailable']),count:z.number().int().nonnegative().nullable(),ruleVersion:z.literal('corpus-integrity.v1')}),
 valuations:z.object({status:z.enum(['available','empty','unavailable']),count:z.number().int().nonnegative().nullable()}),
 portfolio:z.object({status:z.enum(['available','empty','unavailable']),count:z.number().int().nonnegative().nullable()}),
}).strict();
export type WorkspaceOverview=z.infer<typeof WorkspaceOverview>;
/** Browser events are hints only. The server must authenticate and revalidate every import. */
export const PublishedValuationEvent=z.object({type:z.literal('filinglens.valuation.published.v1'),candidateKey:z.string().regex(/^[A-Z0-9.:-]{1,60}$/),valuationVersionId:z.string().regex(/^flv1_[a-f0-9]{64}$/)}).strict();
export function acceptedPublication(event:{origin:string;source:unknown;data:unknown},origin:string,source:unknown,candidateKey:string){
 if(!source||event.source!==source||event.origin!==origin)return null;
 const p=PublishedValuationEvent.safeParse(event.data);return p.success&&p.data.candidateKey===candidateKey?p.data:null;
}
