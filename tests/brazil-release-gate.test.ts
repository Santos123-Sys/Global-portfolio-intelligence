import {afterEach,expect,it,vi} from 'vitest';
import {spawnSync} from 'node:child_process';
import {brazilReleaseGate,type BrazilCanaryResult} from '../src/lib/market/brazil-release-gate';
import {brazilHistoryFixture} from './brazil-history-fixture';
import {checkBrazilMarket} from '../scripts/check-brazil-market';

const mocks=vi.hoisted(()=>({acquire:vi.fn(),consumer:vi.fn()}));
vi.mock('../src/lib/market/history-store',()=>({riskConnection:()=>({base:new URL('https://risk.test'),token:'synthetic-secret'})}));
vi.mock('../src/lib/market/brazil-evidence-provider',()=>({acquireBrazilEvidence:mocks.acquire}));
vi.mock('../scripts/check-brazil-risk',()=>({checkBrazilRisk:mocks.consumer}));
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();vi.useRealTimers();mocks.acquire.mockReset();mocks.consumer.mockReset();});
const hash='a'.repeat(64);
function ready(symbol='PETR4'):BrazilCanaryResult{return {symbol,status:'ready',stage:'complete',normalization:'verified',consumer:'verified',sourceHash:hash,snapshotId:'mh1_'+hash,sourceHashBasis:'brazil-gross-entitlement.v1',observations:1247,issues:[],unresolved:[],unresolvedCount:0};}
it('allows only a complete selected sample with exact consumer lineage, never certifying the market',()=>{
 expect(brazilReleaseGate(true,['PETR4'],[ready()])).toMatchObject({status:'passed',scope:'selected_instruments_only',marketCertified:false,certifiedSymbols:['PETR4']});
});
it.each(['missing','duplicate','extra','catalog','unmapped','denied','short','disputed','consumer','hash','basis','unresolved','observations'])('blocks %s evidence',kind=>{
 const rows=[ready()];let catalog=true;
 if(kind==='missing')rows.pop();if(kind==='duplicate')rows.push(ready());if(kind==='extra')rows.push(ready('VALE3'));
 if(kind==='catalog')catalog=false;if(kind==='unmapped')rows[0].status='issuer_mapping_required';
 if(kind==='denied')rows[0].status='unavailable_or_review_required';if(kind==='short')rows[0].status='short_history';
 if(kind==='disputed')rows[0].issues=['independent_price_disputed'];if(kind==='consumer')rows[0].consumer='not_eligible';
 if(kind==='hash')rows[0].snapshotId='mh1_'+'b'.repeat(64);if(kind==='basis')rows[0].sourceHashBasis='vendor-adjusted-close';
 if(kind==='unresolved')rows[0].unresolvedCount=1;if(kind==='observations')rows[0].observations=undefined;
 expect(brazilReleaseGate(catalog,['PETR4'],rows)).toMatchObject({status:'blocked',certifiedSymbols:[],marketCertified:false});
});
it('does not let successful discovery hide source denial; sanitizes failures and continues the sample',async()=>{
 vi.stubEnv('BRAZIL_MARKET_CANARY_SYMBOLS','PETR4,VALE3');
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2026-10-19T13:00:00Z');
 const log=vi.spyOn(console,'log').mockImplementation(()=>{});
 const h=brazilHistoryFixture();
 mocks.acquire.mockRejectedValueOnce(Error('history_brazil_raw_http_403')).mockRejectedValueOnce(Error('secret https://provider.test?token=private'));
 const fetcher=vi.fn<typeof fetch>();
 // Return correctly bound primary identities for both sample members.
 let primary=0;
 fetcher.mockImplementation(async input=>{
  if(new URL(String(input)).hostname==='brapi.dev')return Response.json({results:[],pagination:{page:1,totalItems:0,hasNextPage:false}});
  if(primary++===0)return Response.json(h);
  return Response.json({...h,symbol:'VALE3.SA',issuerId:'br:33592510000154',sourceUrl:'https://query1.finance.yahoo.com/v8/finance/chart/VALE3.SA',brazilEvidence:undefined,secondary:undefined});
 });
 const report=await checkBrazilMarket(fetcher);
 expect(report.gate.status).toBe('blocked');expect(report.results).toHaveLength(2);
 expect(report.results[0]).toMatchObject({stage:'acquisition',reason:'history_brazil_raw_http_403'});
 expect(report.results[1].reason).toBe('secondary_invalid');expect(mocks.consumer).not.toHaveBeenCalled();
 expect(JSON.stringify(log.mock.calls)).not.toContain('private');
});
it('requires a live consumer receipt even when deterministic source assessment passes',async()=>{
 vi.stubEnv('BRAZIL_MARKET_CANARY_SYMBOLS','PETR4');vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2026-10-19T13:00:00Z');
 vi.spyOn(console,'log').mockImplementation(()=>{});const h=brazilHistoryFixture();mocks.acquire.mockResolvedValue({});
 mocks.consumer.mockRejectedValueOnce(Error('risk_canary_contract'));
 const fetcher=async(input:RequestInfo|URL)=>new URL(String(input)).hostname==='brapi.dev'
  ?Response.json({results:[],pagination:{page:1,totalItems:0,hasNextPage:false}}):Response.json(h);
 expect((await checkBrazilMarket(fetcher)).gate.status).toBe('blocked');
 mocks.consumer.mockResolvedValueOnce({sourceHash:hash,snapshotId:'mh1_'+hash});
 expect((await checkBrazilMarket(fetcher)).gate.status).toBe('passed');
});
it('rejects invalid sample configuration before making requests',async()=>{
 vi.stubEnv('BRAZIL_MARKET_CANARY_SYMBOLS','VALE3,VALE3');const fetcher=vi.fn();
 await expect(checkBrazilMarket(fetcher)).rejects.toThrow('history_brazil_canary_configuration');expect(fetcher).not.toHaveBeenCalled();
});
it('the standalone release command exits nonzero on configuration failure without provider calls',()=>{
 const result=spawnSync(process.execPath,['--import','tsx','scripts/brazil-market-release.ts'],{encoding:'utf8',env:{...process.env,BRAZIL_MARKET_CANARY_SYMBOLS:'VALE3,VALE3'}});
 expect(result.status).toBe(1);expect(result.stderr).toContain('"status":"blocked"');
});
