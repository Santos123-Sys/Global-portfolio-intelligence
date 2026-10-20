import {createHash} from 'node:crypto';
import proof from '../../../data/brazil-issuer-proof.json';
import type {MarketHistory} from './history-quality';
import type {SecondaryPrices} from './price-reconciliation';

// Never guess the owner of a generic credential or send it to multiple vendors.
export function configuredSecondary(history:Pick<MarketHistory,'issuerId'|'symbol'>){
 if(history.issuerId.startsWith('br:'))return process.env.BRAPI_API_KEY&&history.symbol.endsWith('.SA')&&proof.mappings.some(m=>m.cnpj===history.issuerId.slice(3)&&m.candidateKey==='BVMF:'+history.symbol.slice(0,-3))?'BrAPI':null;
 if(process.env.ALPHA_VANTAGE_API_KEY)return 'Alpha Vantage';
 return process.env.EODHD_API_KEY||(process.env.MARKET_DATA_PROVIDER?.toLowerCase()==='eodhd'&&process.env.MARKET_DATA_API_KEY)?'EODHD':null;
}
export async function alternativePrices(history:MarketHistory,fetcher:typeof fetch=fetch):Promise<SecondaryPrices|undefined>{
 const provider=configuredSecondary(history);if(!provider||provider==='Alpha Vantage')return;
 const brazil=provider==='BrAPI',symbol=brazil?history.symbol.slice(0,-3):history.symbol+'.US';
 const sourceUrl=brazil?'https://brapi.dev/api/v2/stocks/historical':'https://eodhd.com/api/eod/'+encodeURIComponent(symbol);
 const url=new URL(sourceUrl),headers:Record<string,string>={accept:'application/json'};
 if(brazil){headers.authorization='Bearer '+process.env.BRAPI_API_KEY;url.search=new URLSearchParams({symbols:symbol,startDate:history.requestedStart,endDate:history.requestedEnd,interval:'1d',sortOrder:'asc'}).toString();}
 else url.search=new URLSearchParams({api_token:process.env.EODHD_API_KEY??process.env.MARKET_DATA_API_KEY!,from:history.requestedStart,to:history.requestedEnd,period:'d',fmt:'json',order:'a'}).toString();
 const r=await fetcher(url,{headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!r.ok){await r.body?.cancel();throw Error('history_secondary_http_'+r.status);}
 const reader=r.body?.getReader();if(!reader)throw Error('history_secondary_empty');
 let bytes=0;const chunks:Uint8Array[]=[];
 try{while(true){const p=await reader.read();if(p.done)break;bytes+=p.value.length;if(bytes>2000000)throw Error('history_secondary_oversized');chunks.push(p.value);}}finally{await reader.cancel();reader.releaseLock();}
 const raw=Buffer.concat(chunks),body=JSON.parse(raw.toString());
 let rows:{date:string;adjustedClose:number}[];
 if(brazil){const result=body.results?.[0];if(body.results?.length!==1||result?.symbol!==symbol||result.requestedSymbol!==symbol||result.changed!==false||result.data?.usedInterval!=='1d'||!Array.isArray(result.data.historicalDataPrice))throw Error('history_secondary_contract');
  rows=result.data.historicalDataPrice.map((v:{date:number;adjustedClose:number})=>({date:new Date(v.date*1000).toISOString().slice(0,10),adjustedClose:v.adjustedClose}));
 }else{if(!Array.isArray(body))throw Error('history_secondary_contract');rows=body.map(v=>({date:v.date,adjustedClose:v.adjusted_close}));}
 const today=new Date().toISOString().slice(0,10);
 // Never substitute close for missing adjusted prices or silently remove an invalid in-window row.
 rows=rows.filter(r=>r.date>=history.requestedStart&&r.date<=history.requestedEnd&&r.date<today);
 return {provider,sourceUrl,symbol:history.symbol,issuerId:history.issuerId,currency:brazil?'BRL':'USD',timezone:brazil?'America/Sao_Paulo':'America/New_York',retrievedAt:new Date().toISOString(),priceBasis:'split-dividend-adjusted',rawSha256:createHash('sha256').update(raw).digest('hex'),rows};
}
