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
 const results=await Promise.allSettled([request('historical'),request('dividends')]);
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
  return [{date:r.date,previousDate:p.date,primaryClose:r.close,previousPrimaryClose:p.close,primaryAdjusted:r.adjustedClose,previousPrimaryAdjusted:p.adjustedClose,secondaryAdjusted:secondary.get(r.date),previousSecondaryAdjusted:secondary.get(p.date),rawClose:number(rawCurrent?.rawClose),previousRawClose:number(rawPrevious?.rawClose),reportedClose:number(rawCurrent?.close),yahooEvents:h.corporateActions.filter(a=>a.date===r.date),brapiEvents:actions.filter(a=>a.exDate===r.date||a.lastDatePrior===p.date||a.lastDatePrior===r.date)}];
 });
 return {symbol:h.symbol,rawStatus:status(results[0]),eventStatus:status(results[1]),rawHash:raw?.hash??null,eventHash:events?.hash??null,rawObservations:rawRows.length,eventObservations:actions.length,conflicts:pairs.length,pairs};
}
