import {describe,it,expect,vi,afterEach} from 'vitest';
import {assessHistory,fiveYearStart,historyHash} from '../src/lib/market/history-quality';
import {dailyChart,marketHistory,integratedServe} from '../ops/portfolio-risk-function';
import {researchState,financeRecovery} from '../src/lib/foundation/research-state';
import {historyFixture} from './market-history-fixture';
const now=Date.parse('2026-10-19T13:00:00Z'),identity={symbol:'AAPL',issuerId:'us:0000320193'};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('five-year history quality gates',()=>{
 it('uses the broad Brazilian index instead of the incomplete ETF and records its source',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);const fixture=historyFixture(),symbols:string[]=[];
  vi.stubGlobal('fetch',async(input:RequestInfo|URL)=>{const symbol=decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1)!);symbols.push(symbol);
   return Response.json({chart:{result:[{meta:{symbol,currency:'BRL',exchangeName:'SAO',exchangeTimezoneName:'America/Sao_Paulo'},timestamp:fixture.rows.map(r=>Date.parse(r.date)/1000),indicators:{quote:[{close:fixture.rows.map(r=>r.close),volume:fixture.rows.map(r=>r.volume)}],adjclose:[{adjclose:fixture.rows.map(r=>r.adjustedClose)}]}}]}});});
  const h=await marketHistory('PETR4.SA','br:33000167000101');expect(symbols).toEqual(['PETR4.SA','^BVSP']);
  expect(assessHistory(h,h,now).status).toBe('ready');expect(h.reference.sourceUrl).toContain('%5EBVSP');
  expect(()=>assessHistory({...h,reference:{...h.reference,sourceUrl:'https://evil.test'}},h,now)).toThrow('history_reference_source_invalid');
 });
 it('recomputes daily returns and historical risk without using raw close',()=>{
  const q=assessHistory(historyFixture(),identity,now);
  expect(q.status).toBe('ready');expect(q.returns[0].simpleReturn).toBeNull();expect(q.returns[1].simpleReturn).toBeCloseTo(Math.exp(.0002)-1,12);
  expect(q.metrics!.annualizedVolatility).toBeLessThan(1e-10);expect(q.metrics!.maxDrawdown).toBe(0);
 });
 it('retains a real drawdown and computes sample annualized volatility',()=>{
  const h=historyFixture();h.rows=h.rows.map((r,i)=>({...r,adjustedClose:i%2===0?100:90}));
  const q=assessHistory(h,identity,now);expect(q.status).toBe('ready');
  expect(q.metrics!.maxDrawdown).toBeCloseTo(-.1);expect(q.metrics!.historicalVar95).toBeCloseTo(.1);
  expect(q.metrics!.annualizedVolatility).toBeGreaterThan(1.6);
 });
 it('quarantines a missing session and does not bridge its return',()=>{
  const h=historyFixture();h.rows.splice(20,1);const q=assessHistory(h,identity,now);
  expect(q.status).toBe('quarantined');expect(q.missingSessions).toHaveLength(1);expect(q.returns[20].simpleReturn).toBeNull();expect(q.metrics).toBeNull();
 });
 it('keeps young listings visibly short instead of manufacturing five years',()=>{
  const h=historyFixture();h.rows=h.rows.slice(-300);const q=assessHistory(h,identity,now);
  expect(q.status).toBe('short_history');expect(q.metrics).toBeNull();
 });
 it.each(['duplicate','unsorted','null','currency','issuer','future','stale','basis','url'] as const)('rejects %s data',kind=>{
  const h=historyFixture();
  if(kind==='duplicate')h.rows.splice(10,0,h.rows[10]);
  if(kind==='unsorted')h.rows.reverse();
  if(kind==='null')h.rows[10].adjustedClose=null as unknown as number;
  if(kind==='currency')h.currency='BRL';
  if(kind==='issuer')h.issuerId='us:0000789019';
  if(kind==='future')h.rows.at(-1)!.date='2027-01-01';
  if(kind==='stale')h.retrievedAt='2020-01-01T00:00:00Z';
  if(kind==='basis')h.priceBasis='close' as never;
  if(kind==='url')h.sourceUrl='https://query1.finance.yahoo.com.attacker.test/v8/finance/chart/AAPL';
  expect(()=>assessHistory(h,identity,now)).toThrow();
 });
 it('quarantines an extreme return instead of hiding it as an adjustment',()=>{
  const h=historyFixture();h.rows[100].adjustedClose*=2;
  expect(assessHistory(h,identity,now).issues).toContain('extreme_return_review');
 });
 it('hashes survive JSONB key ordering and detect changed prices',async()=>{
  const h=historyFixture(),hash=await historyHash(h);
  expect(await historyHash(Object.fromEntries(Object.entries(h).reverse()))).toBe(hash);
  h.rows[0].adjustedClose+=1;expect(await historyHash(h)).not.toBe(hash);
 });
 it('handles leap-day lookback without rolling into March',()=>expect(fiveYearStart('2024-02-29')).toBe('2019-02-28'));
 it('provider adapter preserves missing adjusted prices for rejection',async()=>{
  const h=historyFixture();vi.useFakeTimers();vi.setSystemTime(now);
  vi.stubGlobal('fetch',async()=>Response.json({chart:{result:[{meta:{symbol:'AAPL',currency:'USD',exchangeName:'NMS',exchangeTimezoneName:'America/New_York'},timestamp:h.rows.map(r=>Date.parse(r.date)/1000),
   indicators:{quote:[{close:h.rows.map(r=>r.close),volume:h.rows.map(r=>r.volume)}],adjclose:[{adjclose:h.rows.map((r,i)=>i===20?null:r.adjustedClose)}]}}]}}));
  const result=await dailyChart('AAPL',h.requestedStart,h.requestedEnd);
  expect(result.rows[20].adjustedClose).toBeNull();
  expect(()=>assessHistory({...h,...result},identity,now)).toThrow('history_rows_invalid');
 });
 it('history provider refuses unauthenticated reads',async()=>{
  vi.stubGlobal('Bun',{env:{PORTFOLIO_RISK_API_TOKEN:'t'.repeat(40)}});
  expect((await integratedServe(new Request('https://risk.test/v1/market-history',{method:'POST',body:'{}'}))).status).toBe(401);
 });
 it('five-year calculation consumes validated snapshots and returns their exact lineage',async()=>{
  const h=historyFixture(),sourceHash=await historyHash(h),snapshotId='mh1_'+sourceHash;
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);
  // Keep real timers for the existing classification scheduler.
  const token='t'.repeat(40);vi.stubGlobal('Bun',{env:{PORTFOLIO_RISK_API_TOKEN:token}});
  vi.stubGlobal('fetch',async(url:URL|RequestInfo)=>{
   if(String(url).includes('data.sec.gov'))return Response.json({cik:320193,tickers:['AAPL'],sic:'3571',addresses:{business:{stateOrCountry:'CA'}}});
   return Response.json({chart:{result:[{meta:{symbol:'SPY',currency:'USD',exchangeName:'PCX',exchangeTimezoneName:'America/New_York'},timestamp:h.rows.map(r=>Date.parse(r.date)/1000),indicators:{quote:[{close:h.rows.map(r=>r.close),volume:h.rows.map(r=>r.volume)}],adjclose:[{adjclose:h.rows.map(r=>r.adjustedClose)}]}}]}});
  });
  const body={workspaceId:crypto.randomUUID(),portfolioId:crypto.randomUUID(),runId:crypto.randomUUID(),positions:[{symbol:'AAPL',shares:1}],issuers:[identity],valuations:[],baseCurrency:'USD',riskFreeRate:0,range:'5y',confirmed:true,marketHistories:[{history:h,sourceHash,snapshotId}]};
  const request=()=>new Request('https://risk.test/v1/portfolio-analyze',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
  const r=await integratedServe(request());expect(r.status).toBe(200);const result=await r.json();
  expect(result.historySnapshots).toEqual([{symbol:'AAPL',snapshotId,sourceHash}]);
  expect(result.warnings.join(' ')).toContain('do not independently certify');
  h.rows[2].adjustedClose=1;expect((await integratedServe(request())).status).toBe(422);
  vi.restoreAllMocks();
 });
 it('turns legacy disabled results into understandable, actionable states',()=>{
  expect(researchState('disabled_or_no_evidence')).toContain('no AI draft');
  expect(financeRecovery('disabled')).toContain('saved run');
 });
});

it('propagates independent price disagreement into the portfolio quality gate',()=>{
 const h=historyFixture();h.secondary={provider:'Alpha Vantage',sourceUrl:'https://www.alphavantage.co/query',symbol:h.symbol,issuerId:h.issuerId,currency:'USD',timezone:'US/Eastern',retrievedAt:h.retrievedAt,rawSha256:'a'.repeat(64),priceBasis:'split-dividend-adjusted',rows:h.rows.map((r,i)=>({date:r.date,adjustedClose:r.adjustedClose*(i===100?1.02:1)}))};
 const q=assessHistory(h,identity,now);expect(q.status).toBe('quarantined');expect(q.metrics).toBeNull();expect(q.issues).toContain('independent_price_disputed');
});
