import {acquireSecondaryEvidence} from '../src/lib/market/secondary-evidence';
import {integratedServe} from '../ops/portfolio-risk-function';
import {historyFixture} from './market-history-fixture';
import {historyHash} from '../src/lib/market/history-quality';
import {it,expect,vi,afterEach} from 'vitest';
import {brazilHistoryFixture} from './brazil-history-fixture';
import {assessHistory} from '../src/lib/market/history-quality';
import {validBrazilIsin} from '../src/lib/market/brazil-market-normalization';
import {acquireBrazilEvidence} from '../src/lib/market/brazil-evidence-provider';
import {brazilMarketCatalog} from '../src/lib/market/brazil-market-catalog';
const now=Date.parse('2026-10-19T13:00:00Z');
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers();});
function fixture(symbol='VALE3'){
 const h=brazilHistoryFixture(),issuer='br:33592510000154';h.brazilEvidence!.events.subscriptions=[];
 h.symbol=symbol+'.SA';h.issuerId=issuer;h.sourceUrl='https://query1.finance.yahoo.com/v8/finance/chart/'+h.symbol;
 Object.assign(h.secondary!,{symbol:h.symbol,issuerId:issuer});
 Object.assign(h.brazilEvidence!,{version:'brazil-evidence.v2',symbol:h.symbol,issuerId:issuer,isin:'BRVALEACNOR0',
  identity:{symbol,cnpj:issuer.slice(3),assetType:'stock',subType:symbol.endsWith('11')?'unit':'stock',profileUrl:'https://brapi.dev/api/v2/stocks/profile',coverageUrl:'https://brapi.dev/api/v2/tickers/coverage',profileSha256:'d'.repeat(64),coverageSha256:'e'.repeat(64)}});
 return h;
}
it.each(['VALE3','ITUB4','ABEV3','WEGE3','SANB11','B3SA3'])('evaluates %s through one engine without borrowing Petrobras exceptions',symbol=>{
 const h=fixture(symbol),q=assessHistory(h,h,now);expect(q.status).toBe('ready');expect(q.brazilNormalization?.version).toBe('brazil-gross-entitlement.v3');
 expect(q.metrics!.annualizedVolatility).toBe(0);expect(q.brazilNormalization!.cash).toEqual([]);
});
it('validates ISIN check digits and rejects another share class in event evidence',()=>{
 expect(validBrazilIsin('BRVALEACNOR0')).toBe(true);expect(validBrazilIsin('BRVALEACNOR1')).toBe(false);
 const h=fixture(),e=h.brazilEvidence!,d=h.rows[30].date;
 e.events.cash=[{exDate:d,recordDate:h.rows[29].date,paymentDate:'2026-01-20',label:'JCP',rawRate:1,isin:'BRITUBACNPR1',verified:true}];
 expect(()=>assessHistory(h,h,now)).toThrow('history_brazil_evidence_invalid');
});
it.each([2,.1,1.02])('corroborates a stock-action factor %s without a spurious price return',factor=>{
 const h=fixture(),e=h.brazilEvidence!,d=h.rows[30].date;
 e.events.stock=[{date:d,factor,isin:e.isin,label:factor<1?'GRUPAMENTO':'DESDOBRAMENTO',recordDate:h.rows[29].date}];
 h.corporateActions=[{date:d,kind:'split',value:factor}];
 h.rows.forEach((r,i)=>{r.close=100/factor;r.adjustedClose=100/factor;e.raw.rows[i]={date:r.date,close:i<30?100:100/factor,adjustedClose:100/factor};e.relay.rows[i].close=e.raw.rows[i].close;h.secondary!.rows[i].adjustedClose=100/factor;});
 const q=assessHistory(h,h,now);expect(q.status).toBe('ready');expect(q.metrics!.annualizedVolatility).toBeLessThan(1e-12);
 h.corporateActions[0].value=factor*1.1;expect(assessHistory(h,h,now).status).toBe('quarantined');
});
it('reconstructs gross JCP returns while retaining the net vendor discrepancy',()=>{
 const h=fixture(),e=h.brazilEvidence!,d=h.rows[30].date;
 e.events.cash=[{exDate:d,recordDate:h.rows[29].date,paymentDate:'2025-01-20',label:'JCP',rawRate:10,isin:e.isin,verified:true}];h.corporateActions=[{date:d,kind:'dividend',value:10}];
 h.rows.forEach((r,i)=>{r.close=i<30?100:90;r.adjustedClose=90;e.raw.rows[i]={date:r.date,close:r.close,adjustedClose:i<30?91.5:90};e.relay.rows[i].close=r.close;h.secondary!.rows[i].adjustedClose=e.raw.rows[i].adjustedClose;});
 const before=JSON.stringify(h),q=assessHistory(h,h,now);
 expect(q.status).toBe('ready');expect(q.reconciliation.status).toBe('disputed');expect(q.metrics!.annualizedVolatility).toBeLessThan(1e-12);expect(JSON.stringify(h)).toBe(before);
});
it.each(['identity','rename','cash','subscription','quote','factor','petrobras_exception'])('blocks unresolved %s and returns no approved risk metrics',kind=>{
 const h=fixture(),e=h.brazilEvidence!,d=h.rows[30].date;
 if(kind==='identity')e.identity!.cnpj='33000167000101';
 if(kind==='rename')e.identity!.symbol='OLDX3';
 if(kind==='cash'||kind==='petrobras_exception'){
  const date=kind==='cash'?d:'2022-11-22',i=h.rows.findIndex(r=>r.date===date);
  e.events.cash=[{exDate:date,recordDate:h.rows[i-1].date,paymentDate:'2026-01-20',label:'DIVIDENDO',rawRate:3.3489,isin:e.isin,verified:true}];h.corporateActions=[{date,kind:'dividend',value:1.748708}];
 }
 if(kind==='subscription')e.events.subscriptions=[{date:d}];
 if(kind==='quote'){h.rows[30].close=99;h.rows[30].adjustedClose=99;e.relay.rows=e.relay.rows.filter(r=>r.date!==d);}
 if(kind==='factor')e.raw.rows[30].adjustedClose=h.secondary!.rows[30].adjustedClose=105;
 try{const q=assessHistory(h,h,now);expect(q.status).toBe('quarantined');expect(q.metrics).toBeNull();}catch(error){expect(error).toBeInstanceOf(Error);expect((error as Error).message).toMatch(/^history_brazil_/);}
});
function html(h:ReturnType<typeof fixture>){return '<input id="codigoNegociacao" value="'+h.symbol.slice(0,-3)+'">Histórico de pregões Fechamento<table>'+h.rows.map(r=>'<tr><td>'+r.date.slice(8)+'/'+r.date.slice(5,7)+'/'+r.date.slice(0,4)+'</td><td>1,00</td><td>1,00</td><td>1,00</td><td>100,00</td><td>0%</td><td>1</td></tr>').join('')+'</table>';}
it('acquires an arbitrary paid listing with bound CNPJ and never downgrades a denial to public access',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);vi.stubEnv('BRAPI_API_KEY','synthetic');vi.stubEnv('BRAZIL_HISTORY_BRAPI_PUBLIC','true');
 const h=fixture('ABEV3'),calls:string[]=[];
 const transport=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const u=new URL(String(input));calls.push(u.pathname);
  if(u.hostname==='cotab3.com.br'){expect(JSON.stringify(init)).not.toContain('synthetic');return new Response(html(h));}
  if(u.pathname.endsWith('/coverage'))return Response.json({results:[{requestedSymbol:'ABEV3',symbol:'ABEV3',changed:false,status:'available',assetType:'stock',subType:'stock',availableData:{historical:true,stockDividends:true}}]});
  expect((init?.headers as Record<string,string>).authorization).toBe('Bearer synthetic');
  const data=u.pathname.endsWith('/profile')?{cnpj:h.issuerId.slice(3)}:u.pathname.endsWith('/historical')?{usedInterval:'1d',historicalDataPrice:h.rows.map(r=>({date:Date.parse(r.date)/1000,rawClose:100,adjustedClose:100}))}:{cashDividends:[],stockDividends:[],subscriptions:[]};
  return Response.json({results:[{requestedSymbol:'ABEV3',symbol:'ABEV3',changed:false,data}]});
 });
 Object.assign(h,await acquireBrazilEvidence(h,transport));expect(assessHistory(h,h,now).status).toBe('ready');expect(calls).toHaveLength(5);
 const denied=vi.fn(async()=>new Response('',{status:403}));await expect(acquireBrazilEvidence(h,denied)).rejects.toThrow('history_brazil_raw_http_403');
 expect(denied).toHaveBeenCalledTimes(2);
},10000);
it('does not borrow public PETR4 access for an arbitrary symbol',async()=>{
 vi.stubEnv('BRAPI_API_KEY','');vi.stubEnv('BRAZIL_HISTORY_BRAPI_PUBLIC','true');const transport=vi.fn();
 await expect(acquireBrazilEvidence(fixture('ABEV3'),transport)).rejects.toThrow('history_brazil_credential_required');expect(transport).not.toHaveBeenCalled();
});
it('discovers the full paginated catalog with no credentials and no automatic portfolio insertion',async()=>{
 const listing=(symbol:string)=>({symbol,name:symbol,assetType:'stock',subType:symbol.endsWith('11')?'unit':'stock',currency:'BRL',exchange:'B3',isActive:true});
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const page=Number(new URL(String(input)).searchParams.get('page'));expect(JSON.stringify(init)).not.toContain('authorization');
  return Response.json({results:[listing(page===1?'B3SA3':'SANB11')],pagination:{page,totalItems:2,hasNextPage:page===1}});
 });
 const catalog=await brazilMarketCatalog(fetcher);expect(catalog.listings.map(l=>l.symbol)).toEqual(['B3SA3','SANB11']);expect(catalog.receipts).toHaveLength(2);
 await expect(brazilMarketCatalog(async()=>Response.json({results:[listing('VALE3')],pagination:{page:1,totalItems:2,hasNextPage:false}}))).rejects.toThrow('history_brazil_catalog_incomplete');
});

it('Risk Studio consumes v2 rows under strict reconciliation with exact dataset lineage',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);const h=fixture();
 const token='t'.repeat(40);vi.stubGlobal('Bun',{env:{PORTFOLIO_RISK_API_TOKEN:token,PRICE_RECONCILIATION_REQUIRED:'true'}});
 const benchmark=historyFixture();
 vi.stubGlobal('fetch',async(input:RequestInfo|URL)=>{
  const u=new URL(String(input));
  if(u.hostname.includes('yahoo'))return Response.json({chart:{result:[{meta:{symbol:'SPY',currency:'USD',exchangeName:'PCX',exchangeTimezoneName:'America/New_York'},timestamp:benchmark.rows.map(r=>Date.parse(r.date)/1000),indicators:{quote:[{close:benchmark.rows.map(r=>r.close),volume:benchmark.rows.map(r=>r.volume)}],adjclose:[{adjclose:benchmark.rows.map(r=>r.adjustedClose)}]}}]}});
  if(u.hostname==='api.frankfurter.dev')return Response.json(benchmark.rows.map(r=>({date:r.date,base:'USD',quote:'BRL',rate:6/1.1})));
  return new Response('',{status:503});
 });
 const sourceHash=await historyHash(h),snapshotId='mh1_'+sourceHash;
 const response=await integratedServe(new Request('https://risk.test/v1/portfolio-analyze',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({workspaceId:crypto.randomUUID(),portfolioId:crypto.randomUUID(),runId:crypto.randomUUID(),positions:[{symbol:h.symbol,shares:1}],issuers:[{symbol:h.symbol,issuerId:h.issuerId}],valuations:[],baseCurrency:'BRL',riskFreeRate:0,range:'5y',confirmed:true,marketHistories:[{history:h,sourceHash,snapshotId}]})}));
 expect(response.status).toBe(200);const body=await response.json();expect(body.metrics.volatility).toBeLessThan(1e-9);expect(body.historySnapshots[0]).toEqual({symbol:h.symbol,sourceHash,snapshotId});
 expect(body.sources.some((s:{symbol:string;priceBasis:string})=>s.symbol===h.symbol&&s.priceBasis==='brazil-gross-entitlement.v3')).toBe(true);
});

it('retains a failed optional acquisition as an explicitly blocked dataset with no approved risk',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);
 vi.stubEnv('PRICE_RECONCILIATION_ENABLED','true');vi.stubEnv('BRAZIL_HISTORY_NORMALIZATION_ENABLED','true');
 vi.stubEnv('BRAZIL_MARKET_NORMALIZATION_ENABLED','true');vi.stubEnv('BRAZIL_HISTORY_BRAPI_PUBLIC','false');vi.stubEnv('BRAPI_API_KEY','');
 const h=fixture('B3SA3');delete h.brazilEvidence;
 const evidence=await acquireSecondaryEvidence(h,vi.fn());expect(evidence.brazilAcquisitionFailure).toBe('history_brazil_credential_required');
 Object.assign(h,evidence);const q=assessHistory(h,h,now);expect(q.status).toBe('quarantined');expect(q.issues).toContain('brazil_evidence_unavailable');expect(q.metrics).toBeNull();
});

it('retains unfamiliar catalog symbols for review without passing them to normalization',async()=>{
 const row={symbol:'ABEV3F',name:'Synthetic fractional-lot example',assetType:'stock',subType:'stock',currency:'BRL',exchange:'B3',isActive:true};
 const catalog=await brazilMarketCatalog(async()=>Response.json({results:[row],pagination:{page:1,totalItems:1,hasNextPage:false}}));
 expect(catalog.listings).toHaveLength(1);expect(catalog.listings[0].normalizationStatus).toBe('symbol_review_required');
 const h=fixture('ABEV3F');expect(()=>assessHistory(h,h,now)).toThrow('history_brazil_identity');
});
it('preserves primary data when fetched v2 evidence fails deterministic validation',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);
 for(const flag of ['PRICE_RECONCILIATION_ENABLED','BRAZIL_HISTORY_NORMALIZATION_ENABLED','BRAZIL_MARKET_NORMALIZATION_ENABLED'])vi.stubEnv(flag,'true');
 vi.stubEnv('BRAZIL_HISTORY_BRAPI_PUBLIC','false');vi.stubEnv('BRAPI_API_KEY','synthetic');
 const h=fixture('ABEV3');delete h.brazilEvidence;const before=JSON.stringify(h);
 const transport=async(input:RequestInfo|URL)=>{
  const u=new URL(String(input));
  if(u.hostname==='cotab3.com.br')return new Response(html(h));
  if(u.pathname.endsWith('/coverage'))return Response.json({results:[{requestedSymbol:'ABEV3',symbol:'ABEV3',changed:false,status:'available',assetType:'stock',subType:'stock',availableData:{historical:true,stockDividends:true}}]});
  const data=u.pathname.endsWith('/profile')?{cnpj:h.issuerId.slice(3)}:u.pathname.endsWith('/historical')?{usedInterval:'1d',historicalDataPrice:h.rows.map(r=>({date:Date.parse(r.date)/1000,rawClose:null,adjustedClose:100}))}:{cashDividends:[],stockDividends:[],subscriptions:[]};
  return Response.json({results:[{requestedSymbol:'ABEV3',symbol:'ABEV3',changed:false,data}]});
 };
 const acquired=await acquireSecondaryEvidence(h,transport);expect(acquired.brazilAcquisitionFailure).toBe('history_brazil_evidence_invalid_price_row');
 expect(acquired.brazilEvidence).toBeUndefined();expect(JSON.stringify(h)).toBe(before);
 expect(assessHistory({...h,...acquired},h,now).status).toBe('quarantined');
},10000);
