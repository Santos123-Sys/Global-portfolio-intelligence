import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {MarketHistory} from './history-quality';
import type {BrazilEvidence} from './brazil-normalization';
import type {SecondaryPrices} from './price-reconciliation';
const rawUrl='https://brapi.dev/api/v2/stocks/historical',eventsUrl='https://brapi.dev/api/v2/stocks/dividends',relayUrl='https://cotab3.com.br/cotacoes';
type RecordValue=Record<string,unknown>;
export function parseCotaPrices(html:string,symbol:string){
 const input=[...html.matchAll(/<input\b[^>]*>/gi)].find(m=>/\bid="codigoNegociacao"/.test(m[0]));
 if(!input||!input[0].includes('value="'+symbol+'"')||!html.includes('Histórico de pregões')||!html.includes('Fechamento'))throw Error('history_brazil_relay_identity');
 const rows=[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(m=>{
  const cells=[...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>c[1].replace(/<[^>]*>/g,'').trim());
  if(!/^\d{2}\/\d{2}\/\d{4}$/.test(cells[0]??''))return [];
  if(cells.length!==7||!/^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d+,\d{2}$/.test(cells[4]))throw Error('history_brazil_relay_contract');
  const [d,month,y]=cells[0].split('/');return [{date:y+'-'+month+'-'+d,close:Number(cells[4].replaceAll('.','').replace(',','.'))}];
 });
 if(rows.length<2||rows.length>1600)throw Error('history_brazil_relay_contract');
 return rows;
}
/** Paced BrAPI reads and the relay share one 20s deadline and at most one same-request retry. */
export async function acquireBrazilEvidence(h:MarketHistory,fetcher:typeof fetch=fetch):Promise<{secondary:SecondaryPrices;brazilEvidence:BrazilEvidence}>{
 if(h.symbol!=='PETR4.SA'||h.issuerId!=='br:33000167000101'||h.currency!=='BRL')throw Error('history_brazil_not_configured');
 // BrAPI explicitly offers complete PETR4 data without a token. Select that
 // documented mode before acquisition; never retry a denial with different credentials.
 // The identity guard above prevents this option from applying to another listing.
 const key=process.env.BRAZIL_HISTORY_BRAPI_PUBLIC==='true'?undefined:process.env.BRAPI_API_KEY;
 const brapiHeaders={accept:'application/json',...(key?{authorization:'Bearer '+key}:{})};
 const signal=AbortSignal.timeout(20000);
 let retries=1;
 async function read(url:URL,init:RequestInit={},limit=2000000){
  const request=()=>fetcher(url,{...init,redirect:'error',cache:'no-store',signal});
  let r=await request();
  if(r.status===429&&url.hostname==='brapi.dev'&&retries>0){
   const value=r.headers.get('retry-after');
   const wait=value===null?2000:/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-Date.now();
   if(Number.isFinite(wait)&&wait>=0&&wait<=5000){await r.body?.cancel();retries--;await delay(Math.max(1000,wait),undefined,{signal});r=await request();}
  }
  if(!r.ok){await r.body?.cancel();const source=url.hostname==='cotab3.com.br'?'relay':url.pathname.endsWith('/historical')?'raw':'events';throw Error('history_brazil_'+source+'_http_'+r.status);}
  const reader=r.body?.getReader();if(!reader)throw Error('history_brazil_empty');const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>limit)throw Error('history_brazil_oversized');chunks.push(p.value);}}
  finally{await reader.cancel();reader.releaseLock();}
  const raw=Buffer.concat(chunks);return {text:raw.toString(),rawSha256:createHash('sha256').update(raw).digest('hex')};
 }
 const historical=new URL(rawUrl);historical.search=new URLSearchParams({symbols:'PETR4',startDate:h.requestedStart,endDate:h.requestedEnd,interval:'1d',sortOrder:'asc',includeRaw:'true'}).toString();
 const dividends=new URL(eventsUrl);dividends.search=new URLSearchParams({symbols:'PETR4',includeRaw:'true'}).toString();
 const dmy=(v:string)=>v.slice(8,10)+'/'+v.slice(5,7)+'/'+v.slice(0,4);
 const rawRead=read(historical,{headers:brapiHeaders});
 const cashRead=rawRead.then(async()=>{await delay(1100,undefined,{signal});return read(dividends,{headers:brapiHeaders});});
 const responses=await Promise.allSettled([
  rawRead,
  cashRead,
  read(new URL(relayUrl),{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({codigoNegociacao:'PETR4',dataInicial:dmy(h.requestedStart),dataFinal:dmy(h.requestedEnd)})},3000000),
 ]);
 const values=responses.map(r=>{if(r.status==='rejected')throw r.reason;return r.value;});
 function unwrap(text:string){
  const b=JSON.parse(text),r=b.results?.[0];if(b.results?.length!==1||r?.requestedSymbol!=='PETR4'||r.symbol!=='PETR4'||r.changed!==false||!r.data)throw Error('history_brazil_identity');return r.data;
 }
 const raw=unwrap(values[0].text),events=unwrap(values[1].text);
 if(raw.usedInterval!=='1d'||!Array.isArray(raw.historicalDataPrice)||!Array.isArray(events.cashDividends)||!Array.isArray(events.stockDividends)||raw.historicalDataPrice.length>1500||events.cashDividends.length>500||events.stockDividends.length>100)throw Error('history_brazil_contract');
 const iso=(v:unknown)=>typeof v==='string'?v.slice(0,10):'';
 const today=new Date().toISOString().slice(0,10),retrievedAt=new Date().toISOString();
 const rows=raw.historicalDataPrice.map((r:RecordValue)=>({date:typeof r.date==='number'?new Date(r.date*1000).toISOString().slice(0,10):'',close:r.rawClose as number,adjustedClose:r.adjustedClose as number})).filter((r:{date:string})=>r.date>=h.requestedStart&&r.date<=h.requestedEnd&&r.date<today);
 const secondary:SecondaryPrices={provider:'BrAPI',sourceUrl:rawUrl,symbol:h.symbol,issuerId:h.issuerId,currency:'BRL',timezone:'America/Sao_Paulo',retrievedAt,priceBasis:'split-dividend-adjusted',rawSha256:values[0].rawSha256,rows:rows.map((r:{date:string;adjustedClose:number})=>({date:r.date,adjustedClose:r.adjustedClose}))};
 const brazilEvidence:BrazilEvidence={version:'brazil-evidence.v1',symbol:'PETR4.SA',issuerId:'br:33000167000101',isin:'BRPETRACNPR6',retrievedAt,
  raw:{sourceUrl:rawUrl,rawSha256:values[0].rawSha256,rows},
  events:{sourceUrl:eventsUrl,rawSha256:values[1].rawSha256,cash:events.cashDividends.map((a:RecordValue)=>({exDate:a.exDate===null?null:iso(a.exDate),recordDate:iso(a.lastDatePrior),paymentDate:iso(a.paymentDate),label:a.label,rawRate:a.rawRate,isin:a.isinCode,verified:a.verified})),stock:events.stockDividends.map((a:RecordValue)=>({date:iso(a.exDate??a.lastDatePrior),factor:a.factor}))},
  relay:{sourceUrl:relayUrl,rawSha256:values[2].rawSha256,rows:parseCotaPrices(values[2].text,'PETR4').filter(r=>r.date<today)}};
 return {secondary,brazilEvidence};
}
