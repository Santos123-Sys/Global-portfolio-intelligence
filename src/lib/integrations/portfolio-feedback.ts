import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {readBoundedJson} from '../request-body';
import {sql,loadWorkspace} from '../foundation/store';
import {resolveIssuer,ValuationVersionV1} from './shared-contracts';
import {readApprovedValuation} from './external-readers';
const number=z.number().finite();
export const PortfolioRequest=z.object({
 idempotencyKey:z.string().uuid(), name:z.string().trim().min(1).max(100),confirmed:z.literal(true),
 positions:z.array(z.object({symbol:z.string().regex(/^[A-Z0-9.-]{1,15}$/),shares:number.positive().max(1e9)}).strict()).min(1).max(10),
 range:z.enum(['6mo','1y','3y']),riskFreeRate:number.min(-.1).max(.4),
}).strict().refine(v=>new Set(v.positions.map(p=>p.symbol)).size===v.positions.length,'Duplicate symbols');
const Holding=z.object({symbol:z.string().max(15),shares:number.positive(),price:number.positive(),value:number.positive(),
 weight:number.min(0).max(1),volatility:number.nullable(),beta:number.nullable(),riskContribution:number.nullable()}).strict();
export const RiskResult=z.object({
 schemaVersion:z.literal('portfolio-analysis.v1'),portfolioId:z.string().uuid(),workspaceId:z.string().uuid(),runId:z.string().uuid(),
 retrievedAt:z.string().datetime(),asOf:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 holdings:z.array(Holding).min(1).max(10),metrics:z.record(number.nullable()),warnings:z.array(z.string().max(500)).max(30),
 sources:z.array(z.object({symbol:z.string(),provider:z.string().max(100),priceBasis:z.string().max(100),lastDate:z.string(),rows:number,cached:z.boolean(),stale:z.boolean()})).max(11),
 methodology:z.string().max(500),returns:z.object({method:z.literal('current-holdings-reconstruction.v1'),
 lookbackReturn:number,contributions:z.array(z.object({symbol:z.string(),lookbackReturn:number,contribution:number})).max(10)}),
 allocation:z.object({method:z.literal('historical-minimum-variance.v1'),maxWeight:z.literal(.45),
 weights:z.array(z.object({symbol:z.string(),weight:number.min(0).max(.450001)})).max(10),warnings:z.array(z.string()).max(10)}).nullable(),
 valuationDiagnostics:z.array(z.object({symbol:z.string(),valuationVersionId:z.string(),currency:z.literal('USD'),
 impliedValuePerShare:number.positive(),price:number.positive(),valueGap:number,valuationAsOf:z.string()})).max(10),
 feedback:z.array(z.object({kind:z.enum(['concentration','drawdown','data_quality','valuation_gap']),message:z.string().max(500)})).max(30),
}).strip().superRefine((v,c)=>{
 if(new Set(v.holdings.map(h=>h.symbol)).size!==v.holdings.length ||
  new Set(v.returns.contributions.map(h=>h.symbol)).size!==v.returns.contributions.length ||
  v.returns.contributions.some(h=>!v.holdings.some(p=>p.symbol===h.symbol)))
  c.addIssue({code:z.ZodIssueCode.custom,message:'Invalid holdings/attribution identity'});
 if(Math.abs(v.holdings.reduce((s,h)=>s+h.weight,0)-1)>1e-6)c.addIssue({code:z.ZodIssueCode.custom,message:'Invalid weights'});
 if(v.returns.contributions.length!==v.holdings.length||Math.abs(v.returns.contributions.reduce((s,h)=>s+h.contribution,0)-v.returns.lookbackReturn)>1e-6)c.addIssue({code:z.ZodIssueCode.custom,message:'Invalid attribution'});
 if(v.allocation&&Math.abs(v.allocation.weights.reduce((s,h)=>s+h.weight,0)-1)>1e-5)c.addIssue({code:z.ZodIssueCode.custom,message:'Invalid allocation'});
});
export async function listPortfolioFeedback(owner:string,workspace:string){
 return (await sql()`SELECT id,payload,created_at FROM gpi_portfolio_feedback WHERE owner_id=${owner} AND workspace_id=${workspace} ORDER BY created_at DESC LIMIT 20`).map(r=>({id:r.id,...r.payload,createdAt:r.created_at}));
}
export async function listValuations(owner:string,workspace:string){
 return (await sql()`SELECT candidate_key,payload FROM gpi_approved_valuations WHERE owner_id=${owner} AND workspace_id=${workspace} ORDER BY created_at DESC LIMIT 100`).map(r=>({candidateKey:r.candidate_key,valuation:ValuationVersionV1.parse(r.payload)}));
}
export async function importValuation(owner:string,workspace:string,candidateKey:string,versionId:string){
 const w=await loadWorkspace(owner),candidate=w.candidates.find(c=>c.key===candidateKey);
 if(!candidate)throw Error('candidate_not_found');
 const identity=resolveIssuer(candidate);if(identity.status!=='source_linked')throw Error('issuer_unmapped');
 const valuation=await readApprovedValuation(versionId,identity.issuer.issuerId,{baseUrl:process.env.FILINGLENS_API_URL??'',token:process.env.FILINGLENS_VALUATION_READ_API_TOKEN??'',workspaceId:workspace});
 await sql()`INSERT INTO gpi_approved_valuations(id,owner_id,workspace_id,candidate_key,payload) VALUES(${versionId},${owner},${workspace},${candidateKey},${sql().json(valuation)})
 ON CONFLICT(workspace_id,id) DO NOTHING`;
 return valuation;
}
export async function runPortfolio(owner:string,workspace:string,raw:unknown,fetcher:typeof fetch=fetch){
 const input=PortfolioRequest.parse(raw),hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 const previous=await sql()`SELECT request_hash,payload FROM gpi_portfolio_feedback WHERE id=${input.idempotencyKey} AND owner_id=${owner} AND workspace_id=${workspace}`;
 if(previous[0]){if(previous[0].request_hash!==hash)throw Error('idempotency_conflict');return previous[0].payload;}
 const valuations=await listValuations(owner,workspace);
 const candidates=(await loadWorkspace(owner)).candidates;
 const applicable=input.positions.flatMap(p=>{
  const matches=candidates.filter(c=>c.ticker===p.symbol);
  if(matches.length!==1)return [];
  const found=valuations.find(v=>v.candidateKey===matches[0].key&&v.valuation.currency==='USD'&&
   Date.now()-Date.parse(v.valuation.approvedAt)<90*86400000);
  return found?[{symbol:p.symbol,...found.valuation}]:[];
 });
 const base=new URL(process.env.PORTFOLIO_RISK_API_URL??''),token=process.env.PORTFOLIO_RISK_API_TOKEN??'';
 if(base.protocol!=='https:'||base.pathname!=='/'||base.username||base.password||base.search||base.hash||token.length<32||/[\r\n]/.test(token))throw Error('provider_not_configured');
 const response=await fetcher(new URL('/v1/portfolio-analyze',base),{method:'POST',redirect:'error',cache:'no-store',
 headers:{'content-type':'application/json',authorization:'Bearer '+token},
 body:JSON.stringify({...input,workspaceId:workspace,portfolioId:input.idempotencyKey,runId:randomUUID(),valuations:applicable}),signal:AbortSignal.timeout(40_000)});
 if(!response.ok){await response.body?.cancel();throw Error('risk_provider_unavailable');}
 const result=await readBoundedJson(new Request('https://response.invalid',{method:'POST',headers:{'content-type':response.headers.get('content-type')??''},body:response.body,duplex:'half'} as RequestInit),128_000);
 if(!result.ok)throw Error('invalid_provider_response');
 const analysis=RiskResult.parse(result.value);
 if(analysis.valuationDiagnostics.some(v=>!applicable.some(a=>a.symbol===v.symbol&&a.valuationVersionId===v.valuationVersionId&&Number(a.impliedValuePerShare)===v.impliedValuePerShare)) ||
   analysis.valuationDiagnostics.length!==applicable.length)throw Error('identity_mismatch');
 if(analysis.workspaceId!==workspace||analysis.portfolioId!==input.idempotencyKey||
 analysis.holdings.length!==input.positions.length||analysis.holdings.some(h=>!input.positions.some(p=>p.symbol===h.symbol&&p.shares===h.shares)))throw Error('identity_mismatch');
 const payload={name:input.name,analysis,authority:'portfolio-risk-studio',sharedAt:new Date().toISOString()};
 await sql().begin(async tx=>{
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${workspace+':risk-feedback'},0))`;
  const existing=await tx`SELECT request_hash FROM gpi_portfolio_feedback WHERE id=${input.idempotencyKey}`;
  if(existing[0]){if(existing[0].request_hash!==hash)throw Error('idempotency_conflict');return;}
  const rows=await tx`SELECT COUNT(*) AS n FROM gpi_portfolio_feedback WHERE workspace_id=${workspace}`;
  if(Number(rows[0].n)>=100)throw Error('feedback_quota_reached');
  await tx`INSERT INTO gpi_portfolio_feedback(id,owner_id,workspace_id,request_hash,payload)
   VALUES(${input.idempotencyKey},${owner},${workspace},${hash},${tx.json(payload)}) ON CONFLICT(id) DO NOTHING`;
 });
 const saved=await sql()`SELECT payload FROM gpi_portfolio_feedback WHERE id=${input.idempotencyKey} AND owner_id=${owner} AND workspace_id=${workspace}`;
 if(!saved[0])throw Error('identity_mismatch');
 return saved[0].payload;
}

