import {describe,it,expect,vi,afterEach} from 'vitest';
import {signHandoff,verifyHandoff,HandoffContext} from '../src/lib/integrations/workspace-handoff';
import {integrationAnalysis,validatePortfolio,integratedServe} from '../ops/portfolio-risk-function';
import {RiskResult,PortfolioRequest} from '../src/lib/integrations/portfolio-feedback';
const workspace='550e8400-e29b-41d4-a716-446655440000',portfolio='550e8400-e29b-41d4-a716-446655440001',run='550e8400-e29b-41d4-a716-446655440002';
afterEach(()=>vi.unstubAllGlobals());
describe('three-app workflow security and deterministic mathematics',()=>{
 it('verifies workspace handoffs, expiry, tampering and bounded lifetime',()=>{
  const c=HandoffContext.parse({version:'workspace-handoff.v1',workspaceId:workspace,reviewerUserId:portfolio,issuerId:'us:0000320193',candidateKey:'XNAS:AAPL',ticker:'AAPL',nonce:run,issuedAt:1000,expiresAt:8200});
  const token=signHandoff(c,'s'.repeat(40));expect(verifyHandoff(token,'s'.repeat(40),1001)).toEqual(c);
  expect(()=>verifyHandoff(token,'other'.repeat(10),1001)).toThrow();
  expect(()=>verifyHandoff(token,'s'.repeat(40),8200)).toThrow('expired_handoff');
  expect(()=>verifyHandoff(token+'x','s'.repeat(40),1001)).toThrow();
  expect(()=>verifyHandoff(signHandoff({...c,expiresAt:8201},'s'.repeat(40)),'s'.repeat(40),1001)).toThrow();
 });
 it('does not accept unsigned or unconfirmed portfolio sharing',async()=>{
  vi.stubGlobal('Bun',{env:{PORTFOLIO_RISK_API_TOKEN:'t'.repeat(40)}});
  expect((await integratedServe(new Request('https://risk.test/v1/portfolio-analyze',{method:'POST'}))).status).toBe(401);
  expect(()=>validatePortfolio({positions:[{symbol:'AAPL',shares:1}],range:'1y',riskFreeRate:0,workspaceId:workspace,portfolioId:portfolio,runId:run,valuations:[],confirmed:false})).toThrow();
  expect(()=>PortfolioRequest.parse({positions:[{symbol:'AAPL',shares:1},{symbol:'AAPL',shares:2}],range:'1y',riskFreeRate:0,idempotencyKey:run,name:'test',confirmed:true})).toThrow();
 });
 it('reconciles reconstructed return contributions and constrains allocation',()=>{
  const symbols=['AAA','BBB','CCC'],lookup=new Map(symbols.concat('SPY').map((symbol,i)=>[symbol,{symbol,provider:'Synthetic test fixture',priceBasis:'adjusted close',currency:'USD',cached:false,stale:false,rows:Array.from({length:100},(_,t)=>({date:new Date(Date.UTC(2026,6,t+1)).toISOString().slice(0,10),price:100+t*(i+1)*.1+Math.sin(t*(i+1))*.4,close:100+t*(i+1)*.1+Math.sin(t*(i+1))*.4}))}]));
  const b={positions:symbols.map(symbol=>({symbol,shares:10})),range:'1y',riskFreeRate:0,workspaceId:workspace,portfolioId:portfolio,runId:run,valuations:[],confirmed:true,benchmark:'SPY'};
  const result=RiskResult.parse(integrationAnalysis(b,lookup));
  expect(result.returns.contributions.reduce((s,c)=>s+c.contribution,0)).toBeCloseTo(result.returns.lookbackReturn,10);
  expect(result.allocation!.weights.every(w=>w.weight<=.450001)).toBe(true);
  expect(result.allocation!.weights.reduce((s,w)=>s+w.weight,0)).toBeCloseTo(1,7);
  expect(()=>RiskResult.parse({...result,returns:{...result.returns,lookbackReturn:100}})).toThrow();
  expect(result.methodology).toContain('not realized');
  for(const sources of [[],[result.sources[0],result.sources[0]],result.sources.map((s,i)=>i===0?{...s,symbol:'UNRELATED'}:s)])
   expect(()=>RiskResult.parse({...result,sources})).toThrow('source provenance');
  expect(()=>RiskResult.parse({...result,asOf:'2026-02-30'})).toThrow();
  expect(()=>RiskResult.parse({...result,metrics:{...result.metrics,marketValue:1}})).toThrow('Portfolio value reconciliation failed');
  const changed=result.holdings.map((h,i)=>({...h,weight:i===0?.5:i===1?.25:.25}));
  expect(()=>RiskResult.parse({...result,holdings:changed})).toThrow('Portfolio value reconciliation failed');
  for(const symbols of [['AAA','AAA','CCC'],['AAA','BBB','UNKNOWN']]){
   const allocation={...result.allocation!,weights:result.allocation!.weights.map((w,i)=>({...w,symbol:symbols[i]}))};
   expect(()=>RiskResult.parse({...result,allocation})).toThrow('Invalid allocation');
  }
 });
});

