import {PGlite} from '@electric-sql/pglite';
import type {Transaction} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {vi,describe,it,expect,beforeAll,afterAll} from 'vitest';
const state=vi.hoisted(()=>({db:null as PGlite|null}));
vi.mock('postgres',()=>{
 function tag(db:PGlite|Transaction){
  const fn=async(strings:TemplateStringsArray,...params:unknown[])=>{const query=strings.reduce((s,x,i)=>s+(i?'$'+i:'')+x,'');return (await db.query(query,params)).rows;};
  fn.json=(v:unknown)=>JSON.stringify(v);fn.begin=(work:(tx:ReturnType<typeof tag>)=>Promise<unknown>)=>state.db!.transaction(tx=>work(tag(tx)));return fn;
 }
 return {default:()=>tag(state.db!)};
});
import {listPortfolioFeedback,runPortfolio} from '../src/lib/integrations/portfolio-feedback';
import {integrationAnalysis} from '../ops/portfolio-risk-function';
const owner='550e8400-e29b-41d4-a716-446655440000',account='550e8400-e29b-41d4-a716-446655440001',other='550e8400-e29b-41d4-a716-446655440002',otherAccount='550e8400-e29b-41d4-a716-446655440003',id='550e8400-e29b-41d4-a716-446655440004';
beforeAll(async()=>{
 vi.stubEnv('DATABASE_URL','postgres://test:test@localhost/test');vi.stubEnv('PORTFOLIO_RISK_API_URL','https://risk.example/');vi.stubEnv('PORTFOLIO_RISK_API_TOKEN','t'.repeat(40));
 state.db=new PGlite();for(const file of ['001_foundation.sql','002_gpi_integration.sql','003_document_corpus.sql','004_portfolio_feedback.sql','004_portfolio_feedback.sql'])await state.db.exec(readFileSync('migrations/'+file,'utf8'));
 await state.db.query("INSERT INTO users(id,email,display_name,password_hash) VALUES($1,'owner@example.test','Owner','test'),($2,'other@example.test','Other','test')",[owner,other]);
 await state.db.query("INSERT INTO accounts(id,name,owner_user_id) VALUES($1,'Owner',$2),($3,'Other',$4)",[account,owner,otherAccount,other]);
},30000);
afterAll(async()=>{await state.db?.close();vi.unstubAllEnvs();});
describe('account-scoped received risk snapshots',()=>{
 it('derives workspace scope, persists once, hides other accounts and rejects retry conflicts',async()=>{
  const input={idempotencyKey:id,name:'Fixture portfolio',confirmed:true,positions:[{symbol:'AAPL',shares:3}],range:'1y',riskFreeRate:0};
  const lookup=new Map(['AAPL','SPY'].map(symbol=>[symbol,{symbol,provider:'Synthetic fixture',priceBasis:'adjusted close',currency:'USD',cached:false,stale:false,rows:Array.from({length:100},(_,t)=>({date:new Date(Date.UTC(2026,6,t+1)).toISOString().slice(0,10),price:100+t*.1,close:100+t*.1}))}]));
  const provider=vi.fn(async(_url:URL|RequestInfo,init?:RequestInit)=>Response.json(integrationAnalysis({...JSON.parse(String(init?.body)),benchmark:'SPY'},lookup)));
  const first=await runPortfolio(owner,account,input,provider as typeof fetch);
  expect(first.analysis.workspaceId).toBe(account);expect(provider).toHaveBeenCalledTimes(1);
  expect((await runPortfolio(owner,account,input,provider as typeof fetch)).analysis.runId).toBe(first.analysis.runId);
  expect(provider).toHaveBeenCalledTimes(1);expect(await listPortfolioFeedback(other,otherAccount)).toHaveLength(0);expect(await listPortfolioFeedback(owner,otherAccount)).toHaveLength(0);
  await expect(runPortfolio(owner,account,{...input,name:'Changed'},provider as typeof fetch)).rejects.toThrow('idempotency_conflict');
  await expect(runPortfolio(owner,account,{...input,idempotencyKey:crypto.randomUUID(),workspaceId:otherAccount},provider as typeof fetch)).rejects.toThrow();
 });
 it('does not save failure or mismatched provider scope',async()=>{
  const input={idempotencyKey:crypto.randomUUID(),name:'Bad scope',confirmed:true,positions:[{symbol:'AAPL',shares:3}],range:'1y',riskFreeRate:0};
  await expect(runPortfolio(owner,account,input,async()=>Response.json({error:'unavailable'},{status:503}))).rejects.toThrow('risk_provider_unavailable');
  const [stored]=await listPortfolioFeedback(owner,account);
  await expect(runPortfolio(owner,account,input,async()=>Response.json({...stored.analysis,workspaceId:otherAccount,portfolioId:input.idempotencyKey}))).rejects.toThrow('identity_mismatch');
  expect(await listPortfolioFeedback(owner,account)).toHaveLength(1);
 });
});

