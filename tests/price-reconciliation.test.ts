import {describe,it,expect,vi,afterEach} from 'vitest';
import {reconcilePrices,type SecondaryPrices} from '../src/lib/market/price-reconciliation';
import {secondaryPrices} from '../src/lib/market/secondary-provider';
import {type MarketHistory} from '../src/lib/market/history-quality';
import {verifiedStarterIdentity} from '../src/lib/foundation/verified-issuers';
import {Candidate} from '../src/lib/foundation/contracts';
import seed from '../data/usa-cvm-universe.json';
import proof from '../data/brazil-issuer-proof.json';
const rows=Array.from({length:1200},(_,i)=>({date:new Date(Date.UTC(2023,0,1+i)).toISOString().slice(0,10),adjustedClose:100+i*.01}));
const primary={symbol:'AAPL',issuerId:'us:0000320193',currency:'USD',requestedStart:rows[0].date,requestedEnd:rows.at(-1)!.date,rows};
const secondary:SecondaryPrices={provider:'Alpha Vantage',sourceUrl:'https://www.alphavantage.co/query',symbol:primary.symbol,issuerId:primary.issuerId,currency:'USD',timezone:'US/Eastern',retrievedAt:'2026-10-20T00:00:00Z',priceBasis:'split-dividend-adjusted',rawSha256:'a'.repeat(64),rows};
const now=Date.parse('2026-10-20T01:00:00Z');
afterEach(()=>vi.unstubAllEnvs());
describe('independent price checks',()=>{
 it('never claims reconciliation without a second dataset',()=>expect(reconcilePrices(primary,undefined,now).status).toBe('not_configured'));
 it('accepts matching returns with a different adjustment anchor',()=>expect(reconcilePrices(primary,{...secondary,rows:rows.map(r=>({...r,adjustedClose:r.adjustedClose*2}))},now).status).toBe('matched'));
 it('quarantines divergence but labels agreeing limited coverage partial',()=>{
  expect(reconcilePrices(primary,{...secondary,rows:rows.map((r,i)=>({...r,adjustedClose:r.adjustedClose*(i===100?1.02:1)}))},now).status).toBe('disputed');
  expect(reconcilePrices(primary,{...secondary,rows:rows.slice(1)},now).status).toBe('partial');
 });
 it('anchors on the last shared session without inventing conflicts for missing dates',()=>{
  const r=reconcilePrices(primary,{...secondary,rows:rows.slice(-251,-1).map(r=>({...r,adjustedClose:r.adjustedClose*2}))},now);
  expect(r.status).toBe('partial');expect(r.comparedSessions).toBe(250);expect(r.missingSessions).toBe(950);expect(r.discrepancies).toEqual([]);
  expect(r.lastComparedDate).toBe(rows.at(-2)!.date);expect(r.comparedReturns).toBe(249);
 });
 it('never hides a conflict behind partial coverage or calls nonadjacent points a matched return',()=>{
  const r=reconcilePrices(primary,{...secondary,rows:rows.slice(-251).map((r,i)=>({...r,adjustedClose:r.adjustedClose*(i===3?1.02:1)}))},now);
  expect(r.status).toBe('disputed');expect(r.conflictingReturns).toBe(2);expect(r.conflictSamples).toHaveLength(2);
  const isolated=reconcilePrices(primary,{...secondary,rows:[rows[0],rows[2]]},now);
  expect(isolated.status).toBe('incomplete');expect(isolated.comparedReturns).toBe(0);
 });
 it('records corporate-action clues without excusing conflicts or joining agreement ranges across gaps',()=>{
  const altered=rows.map((r,i)=>({...r,adjustedClose:r.adjustedClose*(i>=100?1.02:1)}));
  const r=reconcilePrices({...primary,corporateActions:[{date:rows[100].date,kind:'dividend',value:1}]},{...secondary,rows:altered.filter((_,i)=>i!==200)},now);
  expect(r.status).toBe('disputed');expect(r.conflictingReturns).toBe(1);expect(r.actionDateConflicts).toBe(1);
  expect(r.agreementRanges).toHaveLength(3);expect(r.agreementRanges[1].end).toBe(rows[199].date);expect(r.agreementRanges[2].start).toBe(rows[201].date);
 });
 it('rejects wrong identity, stale, unsorted, malformed, nonpositive and forged sources',()=>{
  for(const patch of [{symbol:'MSFT'},{currency:'BRL'},{retrievedAt:'2020-01-01'},{sourceUrl:'https://evil.example'},{rows:[...rows].reverse()},{rows:rows.map((r,i)=>i===1?{...r,adjustedClose:0}:r)}])expect(()=>reconcilePrices(primary,{...secondary,...patch} as SecondaryPrices,now)).toThrow();
 });
 it('makes no external call without configuration or for unmapped foreign provider symbols',async()=>{
  const fetcher=vi.fn();await secondaryPrices(primary as MarketHistory,fetcher);expect(fetcher).not.toHaveBeenCalled();
  vi.stubEnv('ALPHA_VANTAGE_API_KEY','synthetic-key');vi.stubEnv('PRICE_RECONCILIATION_ENABLED','true');
  await secondaryPrices({...primary,issuerId:'br:33000167000101'} as MarketHistory,fetcher);expect(fetcher).not.toHaveBeenCalled();
 });
 it('does not convert provider quota/error envelopes into empty valid data',async()=>{
  vi.stubEnv('ALPHA_VANTAGE_API_KEY','synthetic-key');vi.stubEnv('PRICE_RECONCILIATION_ENABLED','true');
  const fetcher=vi.fn(async()=>Response.json({Information:'premium access required'}));
  await expect(secondaryPrices(primary as MarketHistory,fetcher)).rejects.toThrow('history_secondary_contract');
 });
});
describe('verified Brazilian starter identities',()=>{
 it('backfills all eight exact old records and keeps user identity changes',()=>{
  for(const p of proof.mappings){const c=Candidate.parse(seed.candidates.find(c=>c.key===p.candidateKey));
   const old={...c,issuer:null,identitySourceUrl:p.listingSourceUrl};expect(verifiedStarterIdentity(old).issuer?.registryId).toBe(p.cnpj);
   expect(verifiedStarterIdentity({...old,name:'Different issuer'}).issuer).toBeNull();expect(verifiedStarterIdentity(c)).toEqual(c);
  }expect(proof.mappings).toHaveLength(8);
 });
 it('CNPJ check digits match independently of ticker names',()=>{
  for(const m of proof.mappings){let n=m.cnpj.slice(0,12);for(let length=12;length<14;length++){
   let weight=length-7,sum=0;for(const digit of n){sum+=Number(digit)*weight--;if(weight===1)weight=9;}
   const remainder=sum%11;n+=remainder<2?'0':String(11-remainder);
  }expect(n).toBe(m.cnpj);}
 });
});
