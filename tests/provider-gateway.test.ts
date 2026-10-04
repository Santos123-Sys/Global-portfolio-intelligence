import { describe, expect, it, vi } from 'vitest';
import { CallBudgetExceededError, KnownPlanLimitError, MinuteBudgetTracker, endpointTemplate, passthroughGateway, type RequestGateway } from '../src/lib/connectors/gateway';
import { FmpProvider } from '../src/lib/connectors/fmp';

describe('endpointTemplate',()=>{
  it('leaves a two-segment path alone',()=>expect(endpointTemplate('/api/screener')).toBe('/api/screener'));
  it('collapses a dynamic third segment',()=>expect(endpointTemplate('/api/eod/NESN.SW')).toBe('/api/eod/:param'));
});
describe('MinuteBudgetTracker',()=>{
  it('allows attempts under the limit and blocks at it',()=>{const tracker=new MinuteBudgetTracker(()=>0);expect(tracker.wouldExceed('fmp',2)).toBe(false);tracker.record('fmp');tracker.record('fmp');expect(tracker.wouldExceed('fmp',2)).toBe(true);});
  it('forgets old attempts',()=>{let now=0;const tracker=new MinuteBudgetTracker(()=>now);tracker.record('fmp');tracker.record('fmp');expect(tracker.wouldExceed('fmp',2)).toBe(true);now=60001;expect(tracker.wouldExceed('fmp',2)).toBe(false);});
  it('tracks providers independently',()=>{const tracker=new MinuteBudgetTracker(()=>0);tracker.record('fmp');tracker.record('fmp');expect(tracker.wouldExceed('fmp',2)).toBe(true);expect(tracker.wouldExceed('stooq',2)).toBe(false);});
});
describe('passthroughGateway',()=>{it('returns perform result',async()=>{const perform=vi.fn().mockResolvedValue('result');expect(await passthroughGateway.run({provider:'x',endpoint:'/x',perform,classify:()=>({outcome:'ok',httpStatus:200})})).toBe('result');expect(perform).toHaveBeenCalledOnce();});});
describe('gateway error messages',()=>{it('keeps generic provider budget diagnostics',()=>{expect(new KnownPlanLimitError('fmp','/x',403,new Date('2026-08-30')).message).toContain('fmp /x');expect(new CallBudgetExceededError('fmp','day',2000).message).toContain('day call budget of 2000');});});

function fakeGateway():RequestGateway&{calls:Array<{provider:string;endpoint:string}>}{const calls:Array<{provider:string;endpoint:string}>=[];return{calls,run:async({provider,endpoint,perform})=>{calls.push({provider,endpoint});return perform();}};}
async function withFetch<T>(route:(url:string)=>unknown,run:()=>Promise<T>):Promise<T>{const original=globalThis.fetch;globalThis.fetch=(async(url:string|URL)=>Response.json(route(String(url)))) as typeof fetch;try{return await run();}finally{globalThis.fetch=original;}}

describe('FmpProvider with an injected gateway',()=>{
  it('routes the discovery screener through the governed provider gateway',async()=>{const gateway=fakeGateway(),provider=new FmpProvider('test-key',gateway);const result=await withFetch(()=>[{symbol:'NESN.SW',companyName:'Nestle',currency:'CHF',marketCap:300000000000}],()=>provider.getSecurityUniverse!('XSWX',10));expect(result[0]).toMatchObject({ticker:'NESN',provider:'fmp'});expect(gateway.calls).toContainEqual({provider:'fmp',endpoint:'/company-screener'});});
  it('searches by both ticker and company name without leaking the API key',async()=>{const gateway=fakeGateway(),provider=new FmpProvider('secret-key',gateway);const result=await withFetch(url=>url.includes('search-symbol')?[{symbol:'AAPL',name:'Apple Inc.',currency:'USD',exchange:'NASDAQ'}]:[{symbol:'AAPL',name:'Apple Inc.',currency:'USD',exchange:'NASDAQ'}],()=>provider.searchCompanies('Apple'));expect(result[0]).toMatchObject({ticker:'AAPL',exchange:'XNAS'});expect(JSON.stringify(result)).not.toContain('secret-key');expect(gateway.calls.map(call=>call.endpoint)).toEqual(expect.arrayContaining(['/search-symbol','/search-name']));});
  it('propagates a self-imposed budget error instead of hiding it',async()=>{const gateway:RequestGateway={run:async()=>{throw new CallBudgetExceededError('fmp','day',2000);}};const provider=new FmpProvider('test-key',gateway);await expect(provider.getSecurityUniverse!('XSWX',10)).rejects.toThrow(/self-imposed day call budget/);});
});
