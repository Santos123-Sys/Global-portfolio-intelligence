import {createHash} from 'node:crypto';
import {readBoundedJson} from '../request-body';
import {assessHistory,type MarketHistory} from './history-quality';

type JsonRecord=Record<string,unknown>;
/** Fixed public instrument; read-only incident evidence, enabled explicitly for one startup. */
export async function inspectBrazilAdjustments(h:MarketHistory,fetcher:typeof fetch=fetch){
 if(process.env.PRICE_ADJUSTMENT_DIAGNOSTICS!=='true'||!process.env.BRAPI_API_KEY||h.symbol!=='PETR4.SA'||h.issuerId!=='br:33000167000101'||h.secondary?.provider!=='BrAPI')return null;
 const quality=assessHistory(h,h),secondary=new Map(h.secondary.rows.map(r=>[r.date,r.adjustedClose]));
 async function request(route:'historical'|'dividends'){
  const url=new URL('https://brapi.dev/api/v2/stocks/'+route);
  url.searchParams.set('symbols','PETR4');url.searchParams.set('includeRaw','true');
  if(route==='historical'){url.searchParams.set('startDate',h.requestedStart);url.searchParams.set('endDate',h.requestedEnd);url.searchParams.set('interval','1d');url.searchParams.set('sortOrder','asc');}
  // Dividend date filters use PAYMENT dates; the diagnostic reads the bounded complete event response.
  const response=await fetcher(url,{redirect:'error',cache:'no-store',headers:{accept:'application/json',authorization:'Bearer '+process.env.BRAPI_API_KEY},signal:AbortSignal.timeout(20000)});
  if(!response.ok){await response.body?.cancel();throw Error('http_'+response.status);}
  const body=await readBoundedJson(new Request('https://response.invalid',{method:'POST',body:response.body,headers:{'content-type':'application/json'},duplex:'half'} as RequestInit),2000000);
  if(!body.ok)throw Error('invalid_response');
  const envelope=body.value as {results?:{requestedSymbol?:string;symbol?:string;changed?:boolean;data?:JsonRecord}[]},result=envelope.results?.[0];
  if(envelope.results?.length!==1||result?.requestedSymbol!=='PETR4'||result.symbol!=='PETR4'||result.changed!==false||!result.data)throw Error('identity_invalid');
  return {data:result.data,hash:createHash('sha256').update(JSON.stringify(body.value)).digest('hex')};
 }
 async function fmpEvidence(){
  if(!process.env.FMP_API_KEY)return null;
  const signal=AbortSignal.timeout(20000);
  async function read(path:string){
   const url=new URL('https://financialmodelingprep.com/stable/'+path);url.search=new URLSearchParams({symbol:'PETR4.SA',from:h.requestedStart,to:h.requestedEnd,apikey:process.env.FMP_API_KEY!}).toString();
   const response=await fetcher(url,{redirect:'error',cache:'no-store',signal});
   if(!response.ok){await response.body?.cancel();throw Error('http_'+response.status);}
   const body=await readBoundedJson(new Request('https://response.invalid',{method:'POST',body:response.body,headers:{'content-type':'application/json'},duplex:'half'} as RequestInit),2000000);
   if(!body.ok||!Array.isArray(body.value))throw Error('invalid_response');
   return body.value as JsonRecord[];
  }
  const profile=await read('profile'),p=profile[0];
  if(profile.length!==1||p.symbol!=='PETR4.SA'||p.currency!=='BRL'||p.isin!=='BRPETRACNPR6'||p.country!=='BR'||p.isAdr!==false)throw Error('identity_invalid');
  const [closes,adjusted]=await Promise.all([read('historical-price-eod/full'),read('historical-price-eod/dividend-adjusted')]);
  if([closes,adjusted].some(rows=>rows.length<2||rows.length>1500||rows.some(r=>r.symbol!=='PETR4.SA'||typeof r.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.date))))throw Error('invalid_response');
  return {profile:{symbol:p.symbol,currency:p.currency,isin:p.isin,exchange:p.exchange,country:p.country},closes,adjusted,hash:createHash('sha256').update(JSON.stringify({profile,closes,adjusted})).digest('hex')};
 }
 const results=await Promise.allSettled([request('historical'),request('dividends'),fmpEvidence()]);
 const third=results[2].status==='fulfilled'?results[2].value:null;
 const thirdCloses=new Map(third?.closes.map(r=>[r.date,r.close])),thirdAdjusted=new Map(third?.adjusted.map(r=>[r.date,r.adjClose]));
 const raw=results[0].status==='fulfilled'?results[0].value:null,events=results[1].status==='fulfilled'?results[1].value:null;
 const status=(r:typeof results[number])=>r.status==='fulfilled'?'available':r.reason instanceof Error&&/^(http_\d{3}|invalid_response|identity_invalid)$/.test(r.reason.message)?r.reason.message:'unavailable';
 const rawRows=Array.isArray(raw?.data.historicalDataPrice)?raw.data.historicalDataPrice as JsonRecord[]:[];
 const rawMap=new Map(rawRows.slice(0,1500).map(r=>[typeof r.date==='number'?new Date(r.date*1000).toISOString().slice(0,10):'',r]));
 const cash=Array.isArray(events?.data.cashDividends)?events.data.cashDividends as JsonRecord[]:[];
 const stock=Array.isArray(events?.data.stockDividends)?events.data.stockDividends as JsonRecord[]:[];
 const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
 const date=(v:unknown)=>typeof v==='string'?v.slice(0,10):null;
 const actions=[...cash.slice(0,500),...stock.slice(0,100)].map(a=>({exDate:date(a.exDate),lastDatePrior:date(a.lastDatePrior),paymentDate:date(a.paymentDate),approvedOn:date(a.approvedOn),rate:number(a.rate),rawRate:number(a.rawRate),factor:number(a.factor),label:typeof a.label==='string'?a.label.slice(0,40):null,isin:typeof a.isinCode==='string'?a.isinCode.slice(0,12):null}));
 const conflictDates=new Set(quality.reconciliation.discrepancies.filter(s=>s.endsWith(':daily_return')).map(s=>s.slice(0,10)));
 const pairs=h.rows.flatMap((r,i)=>{
  if(!conflictDates.has(r.date))return [];
  const p=h.rows[i-1],rawCurrent=rawMap.get(r.date),rawPrevious=rawMap.get(p.date);
  return [{date:r.date,previousDate:p.date,primaryClose:r.close,previousPrimaryClose:p.close,primaryAdjusted:r.adjustedClose,previousPrimaryAdjusted:p.adjustedClose,secondaryAdjusted:secondary.get(r.date),previousSecondaryAdjusted:secondary.get(p.date),rawClose:number(rawCurrent?.rawClose),previousRawClose:number(rawPrevious?.rawClose),reportedClose:number(rawCurrent?.close),thirdClose:number(thirdCloses.get(r.date)),previousThirdClose:number(thirdCloses.get(p.date)),thirdAdjusted:number(thirdAdjusted.get(r.date)),previousThirdAdjusted:number(thirdAdjusted.get(p.date)),yahooEvents:h.corporateActions.filter(a=>a.date===r.date),brapiEvents:actions.filter(a=>a.exDate===r.date||a.lastDatePrior===p.date||a.lastDatePrior===r.date)}];
 });
 const rawComparison=h.rows.flatMap(r=>{const close=number(rawMap.get(r.date)?.rawClose);return close===null?[]:[{date:r.date,difference:Math.abs(close-r.close)}];});
 const fitsCent=(value:number)=>Math.abs(value-Math.round(value*100)/100)<=Math.max(1,value)*2**-23;
 return {symbol:h.symbol,rawStatus:status(results[0]),eventStatus:status(results[1]),thirdStatus:status(results[2]),thirdProfile:third?.profile??null,thirdHash:third?.hash??null,thirdObservations:third?.closes.length??0,rawHash:raw?.hash??null,eventHash:events?.hash??null,rawObservations:rawRows.length,eventObservations:actions.length,
  rawCompared:rawComparison.length,rawMatchesWithinHalfCent:rawComparison.filter(r=>r.difference<=.005).length,rawMaxDifference:rawComparison.length?Math.max(...rawComparison.map(r=>r.difference)):null,
  rawConflictSamples:rawComparison.filter(r=>r.difference>.005).slice(0,5),primaryAdjustedOnCentGrid:h.rows.filter(r=>fitsCent(r.adjustedClose)).length,primaryClosesOnCentGrid:h.rows.filter(r=>fitsCent(r.close)).length,
  conflicts:pairs.length,pairs};
}
