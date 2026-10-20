import {createHash} from 'node:crypto';
import type {MarketHistory} from './history-quality';
import type {SecondaryPrices} from './price-reconciliation';
/** Fixed official endpoint. No credential URLs, provider errors or response bodies are logged. */
export async function secondaryPrices(history:MarketHistory,fetcher:typeof fetch=fetch):Promise<SecondaryPrices|undefined>{
 const key=process.env.ALPHA_VANTAGE_API_KEY;
 if(!key||process.env.PRICE_RECONCILIATION_ENABLED!=='true')return undefined;
 // Global symbol conventions differ. Brazil needs a separately verified provider mapping.
 if(!history.issuerId.startsWith('us:')||history.currency!=='USD')return undefined;
 const url=new URL('https://www.alphavantage.co/query');url.search=new URLSearchParams({function:'TIME_SERIES_DAILY_ADJUSTED',symbol:history.symbol,outputsize:'full',apikey:key}).toString();
 const response=await fetcher(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok){await response.body?.cancel();throw Error('history_secondary_unavailable');}
 const reader=response.body?.getReader();if(!reader)throw Error('history_secondary_empty');
 const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>6000000)throw Error('history_secondary_oversized');chunks.push(part.value);}}
 finally{await reader.cancel();reader.releaseLock();}
 const raw=Buffer.concat(chunks),body=JSON.parse(raw.toString());
 const meta=body['Meta Data'],series=body['Time Series (Daily)'];
 if(meta?.['2. Symbol']!==history.symbol||!['US/Eastern','America/New_York'].includes(meta?.['5. Time Zone'])||!series||typeof series!=='object')throw Error('history_secondary_contract');
 const rows=Object.entries(series).filter(([date])=>date>=history.requestedStart&&date<=history.requestedEnd&&date<new Date().toISOString().slice(0,10)).sort(([a],[b])=>a.localeCompare(b))
  .map(([date,value])=>({date,adjustedClose:Number((value as Record<string,unknown>)['5. adjusted close'])}));
 return {provider:'Alpha Vantage',sourceUrl:'https://www.alphavantage.co/query',symbol:history.symbol,issuerId:history.issuerId,currency:'USD',timezone:meta['5. Time Zone'],retrievedAt:new Date().toISOString(),priceBasis:'split-dividend-adjusted',rawSha256:createHash('sha256').update(raw).digest('hex'),rows};
}
