import {it,expect,vi,afterEach} from 'vitest';
import {acquireSecondaryEvidence,fmpPrices} from '../src/lib/market/secondary-evidence';
import {historyFixture} from './market-history-fixture';
import {assessHistory} from '../src/lib/market/history-quality';
const now=Date.parse('2026-10-19T13:00:00Z');
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
function configure(){vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);vi.stubEnv('PRICE_RECONCILIATION_ENABLED','true');vi.stubEnv('EODHD_API_KEY','eod-only');vi.stubEnv('FMP_API_KEY','fmp-only');}
it('uses a full FMP witness to complement partial EODHD coverage, retaining both',async()=>{
 configure();const h=historyFixture(),requests:string[]=[];
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>{const u=new URL(String(input));requests.push(u.hostname);
  if(u.hostname==='eodhd.com'){expect(u.searchParams.get('api_token')).toBe('eod-only');expect(String(u)).not.toContain('fmp-only');return Response.json(h.rows.slice(-251).map(r=>({date:r.date,adjusted_close:r.adjustedClose})));}
  expect(u.origin+u.pathname).toBe('https://financialmodelingprep.com/stable/historical-price-eod/dividend-adjusted');expect(u.searchParams.get('apikey')).toBe('fmp-only');expect(String(u)).not.toContain('eod-only');
  return Response.json([...h.rows].reverse().map(r=>({symbol:'AAPL',date:r.date,adjClose:r.adjustedClose*2})));
 });
 Object.assign(h,await acquireSecondaryEvidence(h,fetcher));const q=assessHistory(h,h,now);
 expect(requests.sort()).toEqual(['eodhd.com','financialmodelingprep.com']);expect(q.status).toBe('ready');expect(q.reconciliation.status).toBe('matched');expect(q.reconciliation.provider).toBe('FMP');
 expect(q.reconciliations.map(r=>r.status)).toEqual(['partial','matched']);expect(h.secondarySupport).toHaveLength(1);
 h.secondary!.rows[10].adjustedClose*=1.02;
 const disputed=assessHistory(h,h,now);expect(disputed.reconciliation.status).toBe('disputed');expect(disputed.status).toBe('quarantined');expect(disputed.metrics).toBeNull();
});
it('preserves failed access diagnostics and falls back only to successful evidence, without retrying denied feeds',async()=>{
 configure();const h=historyFixture();const fetcher=vi.fn(async(input:RequestInfo|URL)=>new URL(String(input)).hostname==='eodhd.com'?Response.json(h.rows.slice(-251).map(r=>({date:r.date,adjusted_close:r.adjustedClose}))):new Response('',{status:403}));
 Object.assign(h,await acquireSecondaryEvidence(h,fetcher));expect(assessHistory(h,h,now).reconciliation.status).toBe('partial');expect(h.secondaryAcquisitionFailures).toEqual([{provider:'FMP',reason:'history_secondary_http_403'}]);expect(fetcher).toHaveBeenCalledTimes(2);
 await expect(acquireSecondaryEvidence(historyFixture(),async()=>new Response('',{status:403}))).rejects.toThrow('history_secondary_unavailable');
});
it('does not call disabled, wrong-market or unconfigured FMP, and rejects wrong symbols, raw-only rows and duplicate dates',async()=>{
 const h=historyFixture(),fetcher=vi.fn();expect(await acquireSecondaryEvidence(h,fetcher)).toEqual({});expect(fetcher).not.toHaveBeenCalled();
 vi.stubEnv('FMP_API_KEY','fmp-only');expect(await fmpPrices({...h,issuerId:'br:33000167000101',symbol:'PETR4.SA',currency:'BRL'},fetcher)).toBeUndefined();expect(fetcher).not.toHaveBeenCalled();
 await expect(fmpPrices(h,async()=>Response.json(h.rows.map(r=>({symbol:'MSFT',...r,adjClose:r.adjustedClose}))))).rejects.toThrow('history_secondary_contract');
 configure();vi.stubEnv('EODHD_API_KEY','');vi.stubEnv('MARKET_DATA_API_KEY','');
 await expect(acquireSecondaryEvidence(h,async()=>Response.json(h.rows.map(r=>({symbol:'AAPL',date:r.date,close:r.close}))))).rejects.toThrow('history_secondary_invalid');
 await expect(acquireSecondaryEvidence(h,async()=>Response.json([h.rows[0],h.rows[0]].map(r=>({symbol:'AAPL',date:r.date,adjClose:r.adjustedClose}))))).rejects.toThrow('history_secondary_invalid');
});
