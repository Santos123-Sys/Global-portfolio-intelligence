import {it,expect,vi,afterEach} from 'vitest';
import {inspectBrazilAdjustments} from '../src/lib/market/brazil-adjustment-diagnostics';
import {historyFixture} from './market-history-fixture';
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
function fixture(){
 vi.stubEnv('FMP_API_KEY','');
 vi.stubEnv('EODHD_API_KEY','');vi.stubEnv('MARKET_DATA_PROVIDER','');vi.stubEnv('PRICE_ADJUSTMENT_FMP_DIAGNOSTICS','true');
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2026-10-19T13:00:00Z');
 const h=historyFixture();Object.assign(h,{symbol:'PETR4.SA',issuerId:'br:33000167000101',currency:'BRL',exchange:'SAO',timezone:'America/Sao_Paulo',sourceUrl:'https://query1.finance.yahoo.com/v8/finance/chart/PETR4.SA',reference:{...h.reference,symbol:'^BVSP',sourceUrl:'https://query1.finance.yahoo.com/v8/finance/chart/%5EBVSP'}});
 h.secondary={provider:'BrAPI',sourceUrl:'https://brapi.dev/api/v2/stocks/historical',symbol:h.symbol,issuerId:h.issuerId,currency:'BRL',timezone:'America/Sao_Paulo',priceBasis:'split-dividend-adjusted',retrievedAt:h.retrievedAt,rawSha256:'a'.repeat(64),rows:h.rows.map((r,i)=>({date:r.date,adjustedClose:r.adjustedClose*(i===20?1.02:1)}))};return h;
}
it('makes no diagnostic calls unless explicitly enabled for the pinned public issuer',async()=>{
 const h=fixture(),fetcher=vi.fn();expect(await inspectBrazilAdjustments(h,fetcher)).toBeNull();
 vi.stubEnv('PRICE_ADJUSTMENT_DIAGNOSTICS','true');vi.stubEnv('BRAPI_API_KEY','synthetic');
 expect(await inspectBrazilAdjustments({...h,issuerId:'br:00000000000000'},fetcher)).toBeNull();expect(fetcher).not.toHaveBeenCalled();
});
it('checks the third vendor ISIN before retaining its public price evidence',async()=>{
 const h=fixture();vi.stubEnv('PRICE_ADJUSTMENT_DIAGNOSTICS','true');vi.stubEnv('BRAPI_API_KEY','synthetic');vi.stubEnv('FMP_API_KEY','third-secret');
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
  const u=new URL(String(input));
  if(u.hostname==='brapi.dev')return new Response('',{status:403});
  expect(u.searchParams.get('apikey')).toBe('third-secret');
  if(u.pathname.endsWith('/profile'))return Response.json([{symbol:'PETR4.SA',currency:'BRL',isin:'BRPETRACNPR6',country:'BR',isAdr:false,exchange:'SAO'}]);
  return Response.json(h.rows.map(r=>({symbol:'PETR4.SA',date:r.date,close:r.close,adjClose:r.adjustedClose})));
 });
 const r=(await inspectBrazilAdjustments(h,fetcher))!;
 expect(r.thirdStatus).toBe('available');expect(r.thirdObservations).toBe(h.rows.length);expect(r.pairs[0].thirdClose).toBe(h.rows[20].close);expect(JSON.stringify(r)).not.toContain('third-secret');expect(fetcher).toHaveBeenCalledTimes(5);
});
it('rejects an ADR or wrong ISIN before requesting third-vendor prices',async()=>{
 const h=fixture();vi.stubEnv('PRICE_ADJUSTMENT_DIAGNOSTICS','true');vi.stubEnv('BRAPI_API_KEY','synthetic');vi.stubEnv('FMP_API_KEY','third-secret');
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>new URL(String(input)).hostname==='brapi.dev'?new Response('',{status:403}):Response.json([{symbol:'PETR4.SA',currency:'BRL',isin:'WRONG',country:'BR',isAdr:false}]));
 const r=(await inspectBrazilAdjustments(h,fetcher))!;expect(r.thirdStatus).toBe('identity_invalid');expect(r.thirdObservations).toBe(0);expect(fetcher).toHaveBeenCalledTimes(3);
});
it('retains prices and ex/record/payment dates as evidence without changing a disputed history',async()=>{
 const h=fixture(),before=JSON.stringify(h);vi.stubEnv('PRICE_ADJUSTMENT_DIAGNOSTICS','true');vi.stubEnv('BRAPI_API_KEY','synthetic');
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const u=new URL(String(input));expect(u.origin).toBe('https://brapi.dev');expect(u.searchParams.get('includeRaw')).toBe('true');expect(String(u)).not.toContain('synthetic');expect((init?.headers as Record<string,string>).authorization).toBe('Bearer synthetic');
  const data=u.pathname.endsWith('historical')?{historicalDataPrice:h.rows.map(r=>({date:Date.parse(r.date)/1000,rawClose:r.close,close:r.adjustedClose}))}:{cashDividends:[{exDate:h.rows[20].date,lastDatePrior:h.rows[19].date,paymentDate:'2026-11-20',rate:.5,rawRate:1,label:'JCP'}]};
  return Response.json({results:[{requestedSymbol:'PETR4',symbol:'PETR4',changed:false,data}]});
 });
 const result=(await inspectBrazilAdjustments(h,fetcher))!;expect(result.conflicts).toBe(2);expect(result.rawCompared).toBe(h.rows.length);expect(result.rawMatchesWithinHalfCent).toBe(h.rows.length);expect(result.rawMaxDifference).toBe(0);expect(result.pairs[0].rawClose).toBe(h.rows[20].close);expect(result.pairs[0].brapiEvents[0].paymentDate).toBe('2026-11-20');expect(JSON.stringify(h)).toBe(before);expect(fetcher).toHaveBeenCalledTimes(2);expect(JSON.stringify(result)).not.toContain('synthetic');
});
it('records denied raw/event access once without retrying or fabricating prices',async()=>{
 const h=fixture();vi.stubEnv('PRICE_ADJUSTMENT_DIAGNOSTICS','true');vi.stubEnv('BRAPI_API_KEY','synthetic');const fetcher=vi.fn(async()=>new Response('',{status:403}));
 const r=(await inspectBrazilAdjustments(h,fetcher))!;expect(r.rawStatus).toBe('http_403');expect(r.eventStatus).toBe('http_403');expect(r.pairs[0].rawClose).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
});
it('checks the documented Brazilian EODHD feed with only its attributed credential',async()=>{
 const h=fixture();vi.stubEnv('PRICE_ADJUSTMENT_DIAGNOSTICS','true');vi.stubEnv('BRAPI_API_KEY','br-only');vi.stubEnv('MARKET_DATA_PROVIDER','eodhd');vi.stubEnv('MARKET_DATA_API_KEY','eod-only');
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
  const u=new URL(String(input));if(u.hostname==='brapi.dev')return new Response('',{status:403});
  expect(u.origin+u.pathname).toBe('https://eodhd.com/api/eod/PETR4.SA');expect(u.searchParams.get('api_token')).toBe('eod-only');expect(String(u)).not.toContain('br-only');
  return Response.json(h.rows.map(r=>({date:r.date,close:r.close,adjusted_close:r.adjustedClose})));
 });
 const r=(await inspectBrazilAdjustments(h,fetcher))!;expect(r.otherStatus).toBe('available');expect(r.otherObservations).toBe(h.rows.length);expect(r.pairs[0].otherClose).toBe(h.rows[20].close);expect(fetcher).toHaveBeenCalledTimes(3);
});
