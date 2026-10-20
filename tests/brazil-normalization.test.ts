import {it,expect,vi,afterEach} from 'vitest';
import {historyFixture} from './market-history-fixture';
import {brazilHistoryFixture as base} from './brazil-history-fixture';
import {assessHistory,historyHash,type MarketHistory} from '../src/lib/market/history-quality';
import {normalizeBrazil} from '../src/lib/market/brazil-normalization';
import {parseCotaPrices,acquireBrazilEvidence} from '../src/lib/market/brazil-evidence-provider';
import {brazilEventReviews} from '../src/lib/market/brazil-event-reviews';
import {integratedServe} from '../ops/portfolio-risk-function';
const now=Date.parse('2026-10-19T13:00:00Z');
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers();});
function event(h:MarketHistory,d:string,rate:number,label='JCP',pay='2026-01-20'){
 const e=h.brazilEvidence!,recordDate=h.reference.dates[h.reference.dates.indexOf(d)-1];e.events.cash.push({exDate:d,recordDate,paymentDate:pay,label,rawRate:rate,isin:e.isin,verified:true});
}
function vendorAdjustments(h:MarketHistory){
 const e=h.brazilEvidence!;let yf=1,bf=1;
 for(let i=h.rows.length-1;i>=0;i--){
  const p=h.rows[i];p.adjustedClose=p.close*yf;e.raw.rows[i].adjustedClose=e.raw.rows[i].close*bf;h.secondary!.rows[i].adjustedClose=e.raw.rows[i].adjustedClose;
  const y=h.corporateActions.find(a=>a.date===p.date)?.value??0;
  const b=e.events.cash.filter(a=>(a.exDate??h.reference.dates[h.reference.dates.indexOf(a.recordDate)+1])===p.date).reduce((s,a)=>s+a.rawRate*(['JCP','RENDIMENTO'].includes(a.label)?(a.paymentDate<'2026-01-01'?.85:.825):1),0);
  if(i){yf*=1-y/h.rows[i-1].close;bf*=1-b/e.raw.rows[i-1].close;}
 }
}
it('reconstructs a flat gross index across a 10% cash entitlement while retaining net-source conflicts',()=>{
 const h=base(),d=h.rows[20].date;event(h,d,10,'JCP','2025-01-20');h.corporateActions=[{date:d,kind:'dividend',value:10}];
 h.rows.forEach((r,i)=>{if(i>=20)r.close=90;h.brazilEvidence!.raw.rows[i].close=r.close;h.brazilEvidence!.relay.rows[i].close=r.close;});vendorAdjustments(h);
 const original=JSON.stringify(h),q=assessHistory(h,h,now);
 expect(q.reconciliation.status).toBe('disputed');expect(q.brazilNormalization?.status).toBe('verified');expect(q.status).toBe('ready');expect(q.brazilNormalization?.originalReturnConflicts).toBe(1);
 expect(q.calculationRows[19].adjustedClose).toBe(90);expect(q.calculationRows[20].adjustedClose).toBe(90);expect(q.returns[20].simpleReturn).toBe(0);expect(q.metrics!.annualizedVolatility).toBeLessThan(1e-12);expect(JSON.stringify(h)).toBe(original);
});
it('requires a third observed quote for disagreements and records harmless identical relay duplicates',()=>{
 const h=base(),r=h.rows[30];r.close=99;r.adjustedClose=99;
 const e=h.brazilEvidence!;e.relay.rows.push({...e.relay.rows[10]});let q=normalizeBrazil(h,now)!;
 expect(q.status).toBe('verified');expect(q.adjudicatedQuoteDates).toEqual([r.date]);expect(q.relayDuplicates).toEqual([h.rows[10].date]);expect(q.originalReturnConflicts).toBe(2);
 e.relay.rows=e.relay.rows.filter(x=>x.date!==r.date);q=normalizeBrazil(h,now)!;expect(q.status).toBe('blocked');expect(q.unresolved).toContain(r.date+':raw_quote_unresolved');expect(assessHistory(h,h,now).metrics).toBeNull();
});
it.each(['conflicting_duplicate','contradictory_third','wrong_issuer','wrong_url','stale','altered_adjusted','split','unknown_cash','changed_factor'])('rejects or quarantines %s evidence',kind=>{
 const h=base(),e=h.brazilEvidence!;
 if(kind==='conflicting_duplicate')e.relay.rows.push({...e.relay.rows[0],close:999});
 if(kind==='contradictory_third')e.relay.rows[10].close=101;
 if(kind==='wrong_issuer')e.isin='WRONG' as never;
 if(kind==='wrong_url')e.relay.sourceUrl='https://evil.test';
 if(kind==='stale')e.retrievedAt='2020-01-01';
 if(kind==='altered_adjusted')e.raw.rows[10].adjustedClose=101;
 if(kind==='split')e.events.stock=[{date:h.rows[10].date,factor:2}];
 if(kind==='unknown_cash'){event(h,h.rows[20].date,1);vendorAdjustments(h);}
 if(kind==='changed_factor'){e.raw.rows[10].adjustedClose=101;h.secondary!.rows[10].adjustedClose=101;}
 try{expect(assessHistory(h,h,now).status).toBe('quarantined');}catch(error){expect(error).toBeInstanceOf(Error);expect((error as Error).message).toMatch(/^history_/);}
});
it.each(Object.keys(brazilEventReviews))('uses the published issuer principal for %s and blocks changed evidence',d=>{
 const h=base(),review=brazilEventReviews[d];event(h,d,review.brapiTotal,'DIVIDENDO','2025-03-20');h.corporateActions=[{date:d,kind:'dividend',value:review.yahooTotal}];vendorAdjustments(h);
 if(d==='2024-12-26'){
  h.brazilEvidence!.events.cash=[];for(const [rate,label,pay] of [[.01053822,'JCP','2025-03-20'],[.65356508,'DIVIDENDO','2025-03-20'],[.65356508,'JCP','2025-03-20'],[.66410331,'JCP','2025-02-20']] as const)event(h,d,rate,label,pay);vendorAdjustments(h);
 }
 const q=normalizeBrazil(h,now)!;expect(q.status).toBe('verified');expect(q.cash[0].amount).toBe(review.principal);expect(q.cash[0].sourceUrl).toBe(review.sourceUrl);
 h.corporateActions[0].value+=.01;vendorAdjustments(h);expect(normalizeBrazil(h,now)!.unresolved).toContain(d+':issuer_review_changed');
});
it('excludes the superseded May record only when the exact cash appears under the reviewed June record',()=>{
 const h=base(),e=h.brazilEvidence!;event(h,'2024-06-12',.44806667,'DIVIDENDO','2024-09-20');event(h,'2024-06-12',.07355446,'JCP','2024-09-20');event(h,'2024-06-12',.52162113,'JCP','2024-08-20');
 for(const a of e.events.cash.slice(0,2))e.events.cash.push({...a,exDate:null,recordDate:'2024-05-13'});
 h.corporateActions=[{date:'2024-06-12',kind:'dividend',value:1.04324226}];vendorAdjustments(h);
 const q=normalizeBrazil(h,now)!;expect(q.status).toBe('verified');expect(q.excluded).toHaveLength(2);expect(q.decisions).toContainEqual({date:'2024-05-14',rule:'superseded_cash_record'});
 e.events.cash.at(-1)!.rawRate+=.01;expect(()=>normalizeBrazil(h,now)).toThrow('history_brazil_evidence_invalid');
});
const html=(symbol:string,rows:{date:string;close:number}[])=>`<input id="codigoNegociacao" value="${symbol}"><h5>Histórico de pregões</h5><table><th>Fechamento</th>${rows.map(r=>`<tr><td>${r.date.slice(8)}/${r.date.slice(5,7)}/${r.date.slice(0,4)}</td><td>1,00</td><td>1,00</td><td>1,00</td><td>${r.close.toFixed(2).replace('.',',')}</td><td>0%</td><td>1</td></tr>`).join('')}</table>`;
it('parses a fixed public form response without executing scripts and rejects identity/shape changes',()=>{
 const rows=base().rows.slice(0,2);expect(parseCotaPrices(html('PETR4',rows)+'<script>throw "never execute"</script>','PETR4')).toEqual(rows.map(r=>({date:r.date,close:r.close})));
 expect(()=>parseCotaPrices(html('PETR3',rows),'PETR4')).toThrow('history_brazil_relay_identity');expect(()=>parseCotaPrices(html('PETR4',rows).replace('100,00','NaN'),'PETR4')).toThrow('history_brazil_relay_contract');
});
it('acquires three bounded fixed sources and never sends the BrAPI key to the public relay',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);vi.stubEnv('BRAPI_API_KEY','br-secret');const h=base();
 const mock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const u=new URL(String(input));
  expect(init?.redirect).toBe('error');expect(init?.signal).toBeInstanceOf(AbortSignal);
  if(u.hostname==='cotab3.com.br'){expect(JSON.stringify(init)).not.toContain('br-secret');expect(init?.method).toBe('POST');return new Response(html('PETR4',h.rows));}
  expect((init?.headers as Record<string,string>).authorization).toBe('Bearer br-secret');
  const data=u.pathname.endsWith('historical')?{usedInterval:'1d',historicalDataPrice:h.rows.map(r=>({date:Date.parse(r.date)/1000,rawClose:r.close,adjustedClose:r.adjustedClose}))}:{cashDividends:[],stockDividends:[]};return Response.json({results:[{requestedSymbol:'PETR4',symbol:'PETR4',changed:false,data}]});
 });
 Object.assign(h,await acquireBrazilEvidence(h,mock));expect(normalizeBrazil(h,now)!.status).toBe('verified');expect(mock).toHaveBeenCalledTimes(3);
 await expect(acquireBrazilEvidence(h,async()=>new Response('',{status:403}))).rejects.toThrow('history_brazil_raw_http_403');
});
it('Risk Studio consumes canonical gross rows under strict reconciliation and rejects a lost quote witness',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);const h=base();h.rows[30].close=99;h.rows[30].adjustedClose=99;
 const token='t'.repeat(40);vi.stubGlobal('Bun',{env:{PORTFOLIO_RISK_API_TOKEN:token,PRICE_RECONCILIATION_REQUIRED:'true'}});
 const benchmark=historyFixture();
 vi.stubGlobal('fetch',async(input:RequestInfo|URL)=>{
  const u=new URL(String(input));
  if(u.hostname.includes('yahoo'))return Response.json({chart:{result:[{meta:{symbol:'SPY',currency:'USD',exchangeName:'PCX',exchangeTimezoneName:'America/New_York'},timestamp:benchmark.rows.map(r=>Date.parse(r.date)/1000),indicators:{quote:[{close:benchmark.rows.map(r=>r.close),volume:benchmark.rows.map(r=>r.volume)}],adjclose:[{adjclose:benchmark.rows.map(r=>r.adjustedClose)}]}}]}});
  if(u.hostname==='api.frankfurter.dev')return Response.json(benchmark.rows.map(r=>({date:r.date,base:'USD',quote:'BRL',rate:6/1.1})));
  return new Response('',{status:503});
 });
 const make=async()=>{const sourceHash=await historyHash(h);return new Request('https://risk.test/v1/portfolio-analyze',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({workspaceId:crypto.randomUUID(),portfolioId:crypto.randomUUID(),runId:crypto.randomUUID(),positions:[{symbol:h.symbol,shares:1}],issuers:[{symbol:h.symbol,issuerId:h.issuerId}],valuations:[],baseCurrency:'BRL',riskFreeRate:0,range:'5y',confirmed:true,marketHistories:[{history:h,sourceHash,snapshotId:'mh1_'+sourceHash}]})});};
 const r=await integratedServe(await make());expect(r.status).toBe(200);const body=await r.json();expect(body.metrics.volatility).toBeLessThan(1e-9);expect(body.historySnapshots[0].symbol).toBe('PETR4.SA');
 h.brazilEvidence!.relay.rows=h.brazilEvidence!.relay.rows.filter(x=>x.date!==h.rows[30].date);expect((await integratedServe(await make())).status).toBe(422);
});
