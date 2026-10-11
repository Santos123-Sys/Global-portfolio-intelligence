import {PGlite} from '@electric-sql/pglite';
import type {Transaction} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {vi,it,expect,beforeAll,afterAll} from 'vitest';
import {drizzle} from 'drizzle-orm/pglite';
import * as schema from '../src/lib/db/schema';
const state=vi.hoisted(()=>({gpi:null as PGlite|null,filing:null as PGlite|null}));
vi.mock('../src/lib/db',()=>({db:new Proxy({}, {get(_target,key){const db=drizzle(state.gpi!,{schema});const v=Reflect.get(db,key);return typeof v==='function'?v.bind(db):v;}})}));
vi.mock('postgres',()=>{
 function tag(db:PGlite|Transaction){
  const fn=async(strings:TemplateStringsArray,...params:unknown[])=>{const q=strings.reduce((s,x,i)=>s+(i?'$'+i:'')+x,'');return (await db.query(q,params)).rows;};
  fn.json=(v:unknown)=>JSON.stringify(v);fn.begin=(work:(tx:ReturnType<typeof tag>)=>Promise<unknown>)=>state.gpi!.transaction(tx=>work(tag(tx)));return fn;
 }
 return {default:()=>tag(state.gpi!)};
});
import {POST as login,DELETE as logout} from '../src/app/api/auth/session/route';
import {POST as handoff} from '../src/app/api/integration/v1/handoff/route';
import {POST as portfolioPost,GET as portfolioGet} from '../src/app/api/integration/v1/portfolio-feedback/route';
import {hashPassword} from '../src/lib/password';
import {saveWorkspace} from '../src/lib/foundation/store';
import {defaultProfile} from '../src/lib/foundation/contracts';
import {integrationAnalysis} from '../ops/portfolio-risk-function';
const root=process.env.FILINGLENS_TEST_ROOT;
const request=(path:string,body:unknown,cookie='')=>new Request('https://gpi.example'+path,{method:'POST',headers:{origin:'https://gpi.example','content-type':'application/json',cookie},body:JSON.stringify(body)});
beforeAll(async()=>{
 if(!root)return;
 vi.stubEnv('DATABASE_URL','postgres://isolated/test');vi.stubEnv('SESSION_SECRET','isolated-session-secret-'.repeat(3));vi.stubEnv('NODE_ENV','test');vi.stubEnv('PUBLIC_APP_URL','https://gpi.example');
 vi.stubEnv('INTEGRATION_SIGNING_SECRET','isolated-signing-secret-'.repeat(3));vi.stubEnv('FILINGLENS_API_URL','https://filing.example/');vi.stubEnv('FILINGLENS_PUBLIC_URL','https://filing.example');vi.stubEnv('GPI_API_URL','https://gpi.example/');vi.stubEnv('FILINGLENS_VALUATION_READ_API_TOKEN','isolated-read-token-'.repeat(3));vi.stubEnv('PORTFOLIO_RISK_API_URL','https://risk.example/');vi.stubEnv('PORTFOLIO_RISK_API_TOKEN','isolated-risk-token-'.repeat(3));
 state.gpi=new PGlite();state.filing=new PGlite();
 for(const name of ['001_foundation.sql','002_gpi_integration.sql','003_document_corpus.sql','004_portfolio_feedback.sql'])await state.gpi.exec(readFileSync('migrations/'+name,'utf8'));
 await state.filing.exec('CREATE TABLE shared_valuation_versions(id text PRIMARY KEY,workspace_id text,request_hash text,payload_json text,audit_json text)');
 const password=await hashPassword('Isolated!ApprovalVerification!2026');
 await state.gpi.query("INSERT INTO users(id,email,display_name,password_hash) VALUES('550e8400-e29b-41d4-a716-446655440000','analyst@example.test','Test analyst',$1),('550e8400-e29b-41d4-a716-446655440001','other@example.test','Other account',$1)",[password]);
 await saveWorkspace('550e8400-e29b-41d4-a716-446655440000',{version:1,profile:defaultProfile,candidates:[{key:'XNAS:AAPL',ticker:'AAPL',name:'Synthetic test issuer',exchange:'XNAS',market:'us',identitySourceUrl:'https://www.sec.gov/files/company_tickers_exchange.json',issuer:{jurisdiction:'us',registryId:'0000320193'}}]});
},30000);
afterAll(async()=>{await state.gpi?.close();await state.filing?.close();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it.skipIf(!root)('real password/session → signed handoff → server-recomputed approval → scoped import → stored risk → logout',async()=>{
 // Import the pinned actual FilingLens implementation. Only SQL transport is adapted;
 // both applications use isolated PostgreSQL engines. No auth or API route is mocked.
 const {Hono}=await import(root+'/node_modules/hono/dist/index.js');
 const {registerValuationPublisher}=await import(root+'/api/valuation-publisher.ts');
 const {prepareValuation}=await import(root+'/api/valuation-manager.ts');
 const app=new Hono();
 registerValuationPublisher(app,async()=>({beginTransaction:()=>state.filing!.exec('BEGIN'),commit:()=>state.filing!.exec('COMMIT'),rollback:()=>state.filing!.exec('ROLLBACK'),end:async()=>{},query:async(q:string,args:unknown[])=>{let n=0;return [(await state.filing!.query(q.replace(/\?/g,()=>'$'+(++n)),args)).rows];}}));
 const signed=await login(request('/api/auth/session',{email:'analyst@example.test',password:'Isolated!ApprovalVerification!2026'}));
 expect(signed.status).toBe(200);const cookie=signed.headers.get('set-cookie')!.split(';')[0];expect(cookie).toContain('portfolio_session=');
 expect((await handoff(request('/api/integration/v1/handoff',{candidateKey:'XNAS:AAPL',confirmed:true}))).status).toBe(401);
 expect((await handoff(request('/api/integration/v1/handoff',{candidateKey:'XNAS:AAPL',confirmed:false},cookie))).status).toBe(422);
 const link=await handoff(request('/api/integration/v1/handoff',{candidateKey:'XNAS:AAPL',confirmed:true},cookie));expect(link.status).toBe(200);
 const ticket=new URLSearchParams(new URL((await link.json()).url).hash.slice(1)).get('integration');
 const context=await app.request('https://filing.example/api/integration/v1/handoff/context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticket})});expect(context.status).toBe(200);
 const {context:ctx}=await context.json();expect(ctx.reviewerUserId).toBe('550e8400-e29b-41d4-a716-446655440000');
 const analysis={jurisdiction:'us',company:{name:'Synthetic approval fixture',ticker:'AAPL',exchange:'NASDAQ',filingType:'10-K',periodEnd:'2025-09-27',filedAt:null,description:'Synthetic test only'},financials:{unit:'USD millions',years:['2025'],revenue:[100],netIncome:[10],eps:null,grossMargin:null,operatingMargin:null,operatingCashFlow:null,capex:null,freeCashFlow:null,dividends:null,buybacks:null,totalAssets:null,totalDebt:null,cash:null}};
 const proposal=await prepareValuation(analysis,'dcf');
 const values:Record<string,number|string>={'dcf.currency':'USD','dcf.base_period':'FY2025','dcf.base_revenue':100,'dcf.equity_adjustment':0,'dcf.net_debt':0,'dcf.shares_outstanding':10,'dcf.terminal_method':'perpetuity_growth','dcf.sbc_treatment':'expense_as_reported','dcf.tax_rate':20,'dcf.da_pct_revenue':3,'dcf.capex_pct_revenue':4,'dcf.nwc_pct_revenue':10,'dcf.risk_free_rate':4,'dcf.beta':1,'dcf.equity_risk_premium':5,'dcf.pre_tax_cost_debt':5,'dcf.debt_weight':20,'dcf.terminal_growth':2,'dcf.scenario_growth_spread':1,'dcf.scenario_margin_spread':1,'dcf.scenario_wacc_spread':.5,'dcf.scenario_terminal_spread':.5};
 const assumptions=proposal.assumptions.map((a:{id:string;proposed_value:unknown})=>({...a,status:'accepted',final_value:values[a.id]??(a.id.includes('revenue_growth')?5:a.id.includes('ebit_margin')?20:a.proposed_value)}));
 const approve={ticket,method:'dcf',confirmed:true,scenario:'base',analysis,assumptions};
 const publish=(body:unknown)=>app.request('https://filing.example/api/integration/v1/valuations',{method:'POST',headers:{origin:'https://filing.example','content-type':'application/json'},body:JSON.stringify(body)});
 expect((await publish({...approve,confirmed:false})).status).toBe(422);
 const published=await publish(approve);expect(published.status).toBe(200);const {valuation}=await published.json();expect(valuation.approvedBy).toBe(ctx.reviewerUserId);expect(Number(valuation.impliedValuePerShare)).toBeGreaterThan(0);
 expect((await (await publish(approve)).json()).reused).toBe(true);
 const readHeaders={authorization:'Bearer '+process.env.FILINGLENS_VALUATION_READ_API_TOKEN,'x-workspace-id':ctx.workspaceId};
 expect((await app.request('https://filing.example/api/integration/v1/valuations/'+valuation.valuationVersionId,{headers:{...readHeaders,'x-workspace-id':'550e8400-e29b-41d4-a716-446655440099'}})).status).toBe(404);
 vi.stubGlobal('fetch',async(url:URL|string,init:RequestInit={})=>{
  if(String(url).startsWith('https://filing.example/'))return app.request(String(url),init);
  if(!String(url).startsWith('https://risk.example/'))throw Error('Unexpected test provider');
  const b=JSON.parse(String(init.body)),lookup=new Map(['AAPL','SPY'].map(symbol=>[symbol,{symbol,provider:'Synthetic test only',priceBasis:'adjusted close',currency:'USD',cached:false,stale:false,rows:Array.from({length:100},(_,i)=>({date:new Date(Date.UTC(2026,5,i+1)).toISOString().slice(0,10),price:100+i,close:100+i}))}]));
  return Response.json(integrationAnalysis({...b,benchmark:'SPY'},lookup));
 });
 const imported=await portfolioPost(request('/api/integration/v1/portfolio-feedback',{action:'import_valuation',candidateKey:'XNAS:AAPL',valuationVersionId:valuation.valuationVersionId},cookie));expect(imported.status).toBe(200);
 const run=await portfolioPost(request('/api/integration/v1/portfolio-feedback',{idempotencyKey:crypto.randomUUID(),name:'Isolated approval test',confirmed:true,baseCurrency:'USD',positions:[{symbol:'AAPL',shares:10}],range:'1y',riskFreeRate:0},cookie));expect(run.status).toBe(200);
 const stored=await portfolioGet(new Request('https://gpi.example/api/integration/v1/portfolio-feedback',{headers:{cookie}}));const body=await stored.json();expect(body.runs).toHaveLength(1);expect(body.valuations[0].valuation.valuationVersionId).toBe(valuation.valuationVersionId);expect(body.runs[0].analysis.valuationDiagnostics[0].valuationVersionId).toBe(valuation.valuationVersionId);
 const otherLogin=await login(request('/api/auth/session',{email:'other@example.test',password:'Isolated!ApprovalVerification!2026'}));const otherCookie=otherLogin.headers.get('set-cookie')!.split(';')[0];
 const otherData=await portfolioGet(new Request('https://gpi.example/api/integration/v1/portfolio-feedback',{headers:{cookie:otherCookie}}));expect((await otherData.json()).runs).toHaveLength(0);
 expect((await portfolioPost(request('/api/integration/v1/portfolio-feedback',{action:'import_valuation',candidateKey:'XNAS:AAPL',valuationVersionId:valuation.valuationVersionId},otherCookie))).status).toBe(503);
 expect((await logout(new Request('https://gpi.example/api/auth/session',{method:'DELETE',headers:{origin:'https://gpi.example',cookie}}))).status).toBe(200);
 expect((await handoff(request('/api/integration/v1/handoff',{candidateKey:'XNAS:AAPL',confirmed:true},cookie))).status).toBe(401);
},60000);
