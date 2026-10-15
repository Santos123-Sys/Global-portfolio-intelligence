import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {readBoundedJson} from '../request-body';
import {sql,loadWorkspace} from '../foundation/store';
import {resolveIssuer,ValuationVersionV1} from './shared-contracts';
import {readApprovedValuation} from './external-readers';
const number=z.number().finite();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
export const Currency=z.enum(['USD','BRL','EUR','CHF','GBP','CAD','AUD','JPY','HKD','CNY','SEK','NOK','DKK','NZD','SGD','INR','MXN','ZAR']);
const Exposure=z.array(z.object({label:z.string().min(1).max(250),weight:number.min(0).max(1)})).min(1).max(10);
const Classifications=z.array(z.object({symbol:z.string(),issuerId:z.string().regex(/^(us:\d{10}|br:\d{14})$/),sector:z.string().max(150).nullable(),country:z.string().max(100).nullable(),industry:z.string().max(150).nullable(),classificationSystem:z.enum(['SIC division (1987)','CVM SETOR_ATIV']),sourceUrl:z.string().url().refine(u=>/^https:\/\/data\.sec\.gov\/submissions\/CIK\d{10}\.json$|^https:\/\/dados\.cvm\.gov\.br\/dados\/CIA_ABERTA\/CAD\/DADOS\/cad_cia_aberta\.csv$/.test(u)),retrievedAt:z.string().datetime(),countryBasis:z.literal('principal-office'),sourceCode:z.string().max(10).nullable()})).max(10);
export const PortfolioRequest=z.object({
 idempotencyKey:z.string().uuid(), name:z.string().trim().min(1).max(100),confirmed:z.literal(true),
 baseCurrency:Currency.default('USD'),
 positions:z.array(z.object({symbol:z.string().regex(/^[A-Z0-9.-]{1,15}$/),shares:number.positive().max(1e9)}).strict()).min(1).max(10),
 range:z.enum(['6mo','1y','3y']),riskFreeRate:number.min(-.1).max(.4),
}).strict().refine(v=>new Set(v.positions.map(p=>p.symbol)).size===v.positions.length,'Duplicate symbols');
const Holding=z.object({symbol:z.string().max(15),shares:number.positive(),price:number.positive(),value:number.positive(),
 weight:number.min(0).max(1),volatility:number.nullable(),beta:number.nullable(),riskContribution:number.nullable(),
 quoteCurrency:Currency.optional(),localPrice:number.positive().optional(),fxRate:number.positive().optional(),fxDate:date.optional()}).strict();
export const RiskResult=z.object({
 schemaVersion:z.literal('portfolio-analysis.v1'),portfolioId:z.string().uuid(),workspaceId:z.string().uuid(),runId:z.string().uuid(),
 baseCurrency:Currency.optional(),classifications:Classifications.optional(),
 exposures:z.object({sector:Exposure,country:Exposure,currency:Exposure,sectorCoverage:number.min(0).max(1.000001),countryCoverage:number.min(0).max(1.000001),countryBasis:z.literal('principal-office')}).optional(),
 fxSources:z.array(z.object({from:Currency,to:Currency,provider:z.literal('ECB via Frankfurter'),sourceUrl:z.literal('https://api.frankfurter.dev/v2/providers/ecb/rates'),retrievedAt:z.string().datetime(),firstDate:z.string(),lastDate:z.string(),rows:number.int().positive().max(1200)})).max(18).optional(),
 retrievedAt:z.string().datetime(),asOf:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 holdings:z.array(Holding).min(1).max(10),metrics:z.record(number.nullable()),warnings:z.array(z.string().max(500)).max(30),
 sources:z.array(z.object({symbol:z.string(),provider:z.string().max(100),priceBasis:z.string().max(100),lastDate:z.string(),rows:number,cached:z.boolean(),stale:z.boolean()})).max(11),
 methodology:z.string().max(500),returns:z.object({method:z.literal('current-holdings-reconstruction.v1'),
 lookbackReturn:number,contributions:z.array(z.object({symbol:z.string(),lookbackReturn:number,contribution:number})).max(10)}),
 allocation:z.object({method:z.literal('historical-minimum-variance.v1'),maxWeight:z.literal(.45),
 weights:z.array(z.object({symbol:z.string(),weight:number.min(0).max(.450001)})).max(10),warnings:z.array(z.string()).max(10)}).nullable(),
 valuationDiagnostics:z.array(z.object({symbol:z.string(),valuationVersionId:z.string(),currency:z.enum(['USD','BRL']),baseCurrency:Currency.optional(),
 impliedValuePerShare:number.positive(),convertedValuePerShare:number.positive().optional(),fxRate:number.positive().optional(),fxDate:z.string().optional(),price:number.positive(),valueGap:number,valuationAsOf:z.string()})).max(10),
 feedback:z.array(z.object({kind:z.enum(['concentration','drawdown','data_quality','valuation_gap']),message:z.string().max(500)})).max(30),
}).strip().superRefine((v,c)=>{
 if(new Set(v.holdings.map(h=>h.symbol)).size!==v.holdings.length ||
  new Set(v.returns.contributions.map(h=>h.symbol)).size!==v.returns.contributions.length ||
  v.returns.contributions.some(h=>!v.holdings.some(p=>p.symbol===h.symbol)))
  c.addIssue({code:z.ZodIssueCode.custom,message:'Invalid holdings/attribution identity'});
 if(Math.abs(v.holdings.reduce((s,h)=>s+h.weight,0)-1)>1e-6)c.addIssue({code:z.ZodIssueCode.custom,message:'Invalid weights'});
 if(v.returns.contributions.length!==v.holdings.length||Math.abs(v.returns.contributions.reduce((s,h)=>s+h.contribution,0)-v.returns.lookbackReturn)>1e-6)c.addIssue({code:z.ZodIssueCode.custom,message:'Invalid attribution'});
 if(v.allocation&&(Math.abs(v.allocation.weights.reduce((s,h)=>s+h.weight,0)-1)>1e-5||v.allocation.weights.length!==v.holdings.length||new Set(v.allocation.weights.map(h=>h.symbol)).size!==v.allocation.weights.length||v.allocation.weights.some(h=>!v.holdings.some(p=>p.symbol===h.symbol))))c.addIssue({code:z.ZodIssueCode.custom,message:'Invalid allocation'});
 if(v.exposures){
  for(const field of ['sector','country','currency'] as const){const rows=v.exposures[field];if(new Set(rows.map(r=>r.label)).size!==rows.length||Math.abs(rows.reduce((s,r)=>s+r.weight,0)-1)>1e-6)c.addIssue({code:z.ZodIssueCode.custom,message:'Invalid exposure totals'});}
  if(!v.classifications||new Set(v.classifications.map(r=>r.symbol)).size!==v.classifications.length||v.classifications.some(r=>!v.holdings.some(h=>h.symbol===r.symbol)))c.addIssue({code:z.ZodIssueCode.custom,message:'Invalid classification identity'});
  for(const field of ['sector','country'] as const){
   const expected=new Map<string,number>();let coverage=0;
   for(const h of v.holdings){const cl=v.classifications?.find(r=>r.symbol===h.symbol);const label=field==='sector'&&cl?.sector?cl.classificationSystem+': '+cl.sector:cl?.[field]||'Unclassified';expected.set(label,(expected.get(label)??0)+h.weight);if(cl?.[field])coverage+=h.weight;}
   if(expected.size!==v.exposures[field].length||v.exposures[field].some(r=>Math.abs(r.weight-(expected.get(r.label)??-1))>1e-6)||Math.abs(coverage-v.exposures[field==='sector'?'sectorCoverage':'countryCoverage'])>1e-6)c.addIssue({code:z.ZodIssueCode.custom,message:'Exposure does not reconcile to sourced holdings'});
  }
  const currencies=new Map<string,number>();for(const h of v.holdings)currencies.set(h.quoteCurrency??'Unclassified',(currencies.get(h.quoteCurrency??'Unclassified')??0)+h.weight);
  if(currencies.size!==v.exposures.currency.length||v.exposures.currency.some(r=>Math.abs(r.weight-(currencies.get(r.label)??-1))>1e-6))c.addIssue({code:z.ZodIssueCode.custom,message:'Currency exposure mismatch'});
  for(const h of v.holdings)if(!h.quoteCurrency||!h.localPrice||!h.fxRate||!h.fxDate||h.fxDate>v.asOf||Date.parse(v.asOf)-Date.parse(h.fxDate)>7*86400000||Math.abs(h.price-h.localPrice*h.fxRate)>h.price*1e-8||Math.abs(h.value-h.shares*h.price)>h.value*1e-8)c.addIssue({code:z.ZodIssueCode.custom,message:'Invalid FX conversion'});
  for(const d of v.valuationDiagnostics)if(d.baseCurrency!==v.baseCurrency||!d.convertedValuePerShare||!d.fxRate||Math.abs(d.impliedValuePerShare*d.fxRate-d.convertedValuePerShare)>d.convertedValuePerShare*1e-8||Math.abs(d.valueGap-(d.convertedValuePerShare/d.price-1))>1e-8||!v.holdings.some(h=>h.symbol===d.symbol&&h.price===d.price))c.addIssue({code:z.ZodIssueCode.custom,message:'Invalid converted valuation'});
 }
});
export async function listPortfolioFeedback(owner:string,workspace:string){
 return (await sql()`SELECT id,payload,created_at FROM gpi_portfolio_feedback WHERE owner_id=${owner} AND workspace_id=${workspace} ORDER BY created_at DESC LIMIT 20`).map(r=>({id:r.id,...r.payload,createdAt:r.created_at}));
}
export async function listValuations(owner:string,workspace:string){
 return (await sql()`SELECT candidate_key,payload FROM gpi_approved_valuations WHERE owner_id=${owner} AND workspace_id=${workspace} ORDER BY created_at DESC LIMIT 100`).map(r=>({candidateKey:r.candidate_key,valuation:ValuationVersionV1.parse(r.payload)}));
}
export async function importValuation(owner:string,workspace:string,candidateKey:string,versionId:string,expected?:{reviewerId:string;nonce:string}){
 const w=await loadWorkspace(owner),candidate=w.candidates.find(c=>c.key===candidateKey);
 if(!candidate)throw Error('candidate_not_found');
 const identity=resolveIssuer(candidate);if(identity.status!=='source_linked')throw Error('issuer_unmapped');
 const valuation=await readApprovedValuation(versionId,identity.issuer.issuerId,{baseUrl:process.env.FILINGLENS_API_URL??'',token:process.env.FILINGLENS_VALUATION_READ_API_TOKEN??'',workspaceId:workspace});
 if(expected){
  if(valuation.approvedBy!==expected.reviewerId)throw Error('reviewer_mismatch');
  const derivedId='flv1_'+createHash('sha256').update(expected.nonce+':'+valuation.method).digest('hex');
  if(derivedId!==valuation.valuationVersionId)throw Error('handoff_valuation_mismatch');
 }
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
  const matches=candidates.filter(c=>(c.market==='br'?c.ticker+'.SA':c.ticker)===p.symbol);
  if(matches.length!==1)return [];
  const found=valuations.find(v=>v.candidateKey===matches[0].key&&
   Date.now()-Date.parse(v.valuation.approvedAt)<90*86400000);
  return found?[{symbol:p.symbol,...found.valuation}]:[];
 });
 const issuers=input.positions.flatMap(p=>{const matches=candidates.filter(c=>(c.market==='br'?c.ticker+'.SA':c.ticker)===p.symbol);if(matches.length!==1)return [];const identity=resolveIssuer(matches[0]);return identity.status==='source_linked'?[{symbol:p.symbol,issuerId:identity.issuer.issuerId}]:[];});
 const base=new URL(process.env.PORTFOLIO_RISK_API_URL??''),token=process.env.PORTFOLIO_RISK_API_TOKEN??'';
 if(base.protocol!=='https:'||base.pathname!=='/'||base.username||base.password||base.search||base.hash||token.length<32||/[\r\n]/.test(token))throw Error('provider_not_configured');
 const runId=randomUUID();
 const response=await fetcher(new URL('/v1/portfolio-analyze',base),{method:'POST',redirect:'error',cache:'no-store',
 headers:{'content-type':'application/json',authorization:'Bearer '+token},
 body:JSON.stringify({...input,workspaceId:workspace,portfolioId:input.idempotencyKey,runId,valuations:applicable,issuers}),signal:AbortSignal.timeout(60_000)});
 if(!response.ok){await response.body?.cancel();throw Error('risk_provider_unavailable');}
 const result=await readBoundedJson(new Request('https://response.invalid',{method:'POST',headers:{'content-type':response.headers.get('content-type')??''},body:response.body,duplex:'half'} as RequestInit),128_000);
 if(!result.ok)throw Error('invalid_provider_response');
 const analysis=RiskResult.parse(result.value);
 if(analysis.baseCurrency!==input.baseCurrency||!analysis.exposures||!analysis.classifications||!analysis.fxSources||analysis.classifications.some(c=>!issuers.some(r=>r.symbol===c.symbol&&r.issuerId===c.issuerId)))throw Error('identity_mismatch');
 if(analysis.valuationDiagnostics.some(v=>!applicable.some(a=>a.symbol===v.symbol&&a.valuationVersionId===v.valuationVersionId&&Number(a.impliedValuePerShare)===v.impliedValuePerShare)) ||
   analysis.valuationDiagnostics.length!==applicable.length)throw Error('identity_mismatch');
 if(analysis.runId!==runId||analysis.workspaceId!==workspace||analysis.portfolioId!==input.idempotencyKey||
 analysis.holdings.length!==input.positions.length||analysis.holdings.some(h=>!input.positions.some(p=>p.symbol===h.symbol&&p.shares===h.shares)))throw Error('identity_mismatch');
 const payload={name:input.name,requestInputs:{positions:input.positions,range:input.range,riskFreeRate:input.riskFreeRate,baseCurrency:input.baseCurrency},analysis,authority:'portfolio-risk-studio',sharedAt:new Date().toISOString()};
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

