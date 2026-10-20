import {it,expect,vi,afterEach} from 'vitest';
import {alternativePrices,configuredSecondary} from '../src/lib/market/available-secondary';
import {reconcilePrices} from '../src/lib/market/price-reconciliation';
import {historyFixture} from './market-history-fixture';
afterEach(()=>vi.unstubAllEnvs());
it('never sends a generic key to an unconfirmed vendor',async()=>{vi.stubEnv('MARKET_DATA_PROVIDER','finnhub');vi.stubEnv('MARKET_DATA_API_KEY','private');const fetcher=vi.fn();expect(configuredSecondary(historyFixture())).toBeNull();await alternativePrices(historyFixture(),fetcher);expect(fetcher).not.toHaveBeenCalled();});
it('keeps BrAPI on an exact verified issuer/listing and does not silently follow symbol changes',async()=>{
 vi.stubEnv('BRAPI_API_KEY','synthetic');const h={...historyFixture(),issuerId:'br:33000167000101',symbol:'PETR4.SA',currency:'BRL' as const};
 expect(configuredSecondary({...h,issuerId:'br:33592510000154'})).toBeNull();
 const fetcher=vi.fn(async(url:URL|RequestInfo,init?:RequestInit)=>{expect(new URL(String(url)).origin).toBe('https://brapi.dev');expect(String(url)).not.toContain('synthetic');expect((init?.headers as Record<string,string>).authorization).toBe('Bearer synthetic');return Response.json({results:[{requestedSymbol:'PETR4',symbol:'PETR4',changed:false,data:{usedInterval:'1d',historicalDataPrice:h.rows.map(r=>({date:Date.parse(r.date)/1000,adjustedClose:r.adjustedClose}))}}]});});
 const second=await alternativePrices(h,fetcher);expect(reconcilePrices(h,second).status).toBe('matched');
 await expect(alternativePrices(h,async()=>Response.json({results:[{requestedSymbol:'PETR4',symbol:'OTHER',changed:true}]}))).rejects.toThrow('history_secondary_contract');
});
it('retains a null adjusted price for rejection and refuses denied feeds',async()=>{
 vi.stubEnv('EODHD_API_KEY','synthetic');const h=historyFixture();
 const second=await alternativePrices(h,async()=>Response.json(h.rows.map((r,i)=>({date:r.date,adjusted_close:i===2?null:r.adjustedClose}))));
 expect(()=>reconcilePrices(h,second)).toThrow('history_secondary_invalid');
 await expect(alternativePrices(h,async()=>new Response('',{status:403}))).rejects.toThrow('history_secondary_http_403');
});
