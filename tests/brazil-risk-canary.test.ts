import {it,expect,vi,afterEach} from 'vitest';
import {checkBrazilRisk} from '../scripts/check-brazil-risk';
import {brazilHistoryFixture} from './brazil-history-fixture';
afterEach(()=>vi.useRealTimers());
it('checks stateless synthetic risk lineage and the exact consumer basis without persisting holdings',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2026-10-19T13:00:00Z');const h=brazilHistoryFixture(),before=JSON.stringify(h);
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  expect(String(input)).toBe('https://risk.test/v1/portfolio-analyze');expect(init?.redirect).toBe('error');const b=JSON.parse(String(init?.body));
  expect(b.positions).toEqual([{symbol:'PETR4.SA',shares:1}]);expect(b.valuations).toEqual([]);expect(b.range).toBe('5y');expect(b.baseCurrency).toBe('BRL');
  const {history:_,...receipt}=b.marketHistories[0];void _;
  return Response.json({schemaVersion:'portfolio-analysis.v1',baseCurrency:'BRL',historySnapshots:[{symbol:h.symbol,...receipt}],sources:[{symbol:h.symbol,priceBasis:'brazil-gross-entitlement.v1'}],metrics:{volatility:0}});
 });
 expect((await checkBrazilRisk(h,new URL('https://risk.test'),'synthetic',fetcher)).status).toBe('verified');expect(fetcher).toHaveBeenCalledTimes(1);expect(JSON.stringify(h)).toBe(before);
});
it('rejects an old risk consumer or a denial and never retries it',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2026-10-19T13:00:00Z');const h=brazilHistoryFixture();
 await expect(checkBrazilRisk(h,new URL('https://risk.test'),'synthetic',async()=>Response.json({schemaVersion:'portfolio-analysis.v1',baseCurrency:'BRL',metrics:{volatility:0}}))).rejects.toThrow('risk_canary_contract');
 const fetcher=vi.fn(async()=>new Response('',{status:403}));await expect(checkBrazilRisk(h,new URL('https://risk.test'),'synthetic',fetcher)).rejects.toThrow('risk_canary_http_403');expect(fetcher).toHaveBeenCalledTimes(1);
});
