import {z} from 'zod';
import {readBoundedJson} from '../request-body';
export const BrazilDataQuery=z.object({
 operation:z.enum(['issuers','facts','screen']),cnpj:z.string().regex(/^[0-9]{14}$/).optional(),
 form:z.enum(['DFP','ITR']).default('DFP'),year:z.number().int().min(2010).max(new Date().getUTCFullYear()).default(new Date().getUTCFullYear()-1),
 scope:z.enum(['consolidated','standalone']).default('consolidated'),offset:z.number().int().min(0).max(100000).default(0),
 limit:z.number().int().min(1).max(100).default(50),activeOnly:z.boolean().default(true),
}).strict().refine(q=>q.operation!=='facts'||Boolean(q.cnpj),'cnpj_required');
export async function readBrazilFundamentals(input:unknown,options:{baseUrl:string;token:string;fetcher?:typeof fetch}){
 const query=BrazilDataQuery.parse(input),url=new URL(options.baseUrl);
 if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||options.token.length<32||/[\r\n]/.test(options.token))throw Error('brazil_finance_config');
 const response=await (options.fetcher??fetch)(new URL('/api/integration/v1/brazil/fundamentals',url),{
  method:'POST',headers:{authorization:'Bearer '+options.token,'content-type':'application/json',accept:'application/json'},
  body:JSON.stringify(query),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(75000),
 });
 if(!response.ok){await response.body?.cancel();throw Error('brazil_finance_unavailable');}
 const result=await readBoundedJson(new Request('https://response.invalid',{method:'POST',body:response.body,
  headers:{'content-type':response.headers.get('content-type')??''},duplex:'half'} as RequestInit),2000000);
 if(!result.ok)throw Error('brazil_finance_contract');
 const expected={issuers:'cvm-issuers.v1',facts:'cvm-companyfacts.v1',screen:'cvm-screen.v1'}[query.operation];
 const envelope=z.object({schemaVersion:z.literal(expected),source:z.object({sourceUrl:z.string().url(),archiveSha256:z.string().regex(/^[a-f0-9]{64}$/),retrievedAt:z.string(),stale:z.literal(false)}).passthrough()}).passthrough().parse(result.value);
 if(new URL(envelope.source.sourceUrl).origin!=='https://dados.cvm.gov.br')throw Error('brazil_finance_source');
 if(query.operation==='facts'&&z.object({issuer:z.object({cnpj:z.literal(query.cnpj!)})}).safeParse(envelope).success===false)throw Error('brazil_finance_identity');
 if(query.operation!=='issuers'&&z.object({form:z.literal(query.form),archiveYear:z.literal(query.year),scope:z.literal(query.scope)}).safeParse(envelope).success===false)throw Error('brazil_finance_period_scope');
 return envelope;
}
