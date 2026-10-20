import {createHash} from 'node:crypto';
import {validDate,type MarketHistory} from './history-quality';
import {reconcilePrices,type SecondaryPrices} from './price-reconciliation';
import {secondaryPrices} from './secondary-provider';
import {acquireBrazilEvidence} from './brazil-evidence-provider';

/** Dedicated FMP credential only; never send another vendor's key here. */
export async function fmpPrices(h:MarketHistory,fetcher:typeof fetch=fetch):Promise<SecondaryPrices|undefined>{
 if(!process.env.FMP_API_KEY||!h.issuerId.startsWith('us:')||h.currency!=='USD'||h.symbol.endsWith('.SA'))return;
 const sourceUrl='https://financialmodelingprep.com/stable/historical-price-eod/dividend-adjusted';
 const url=new URL(sourceUrl);url.search=new URLSearchParams({symbol:h.symbol,from:h.requestedStart,to:h.requestedEnd,apikey:process.env.FMP_API_KEY}).toString();
 const response=await fetcher(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok){await response.body?.cancel();throw Error('history_secondary_http_'+response.status);}
 const reader=response.body?.getReader();if(!reader)throw Error('history_secondary_empty');
 const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const p=await reader.read();if(p.done)break;bytes+=p.value.length;if(bytes>2000000)throw Error('history_secondary_oversized');chunks.push(p.value);}}
 finally{await reader.cancel();reader.releaseLock();}
 const raw=Buffer.concat(chunks),body=JSON.parse(raw.toString());
 if(!Array.isArray(body)||body.length<2||body.length>5000||body.some(r=>r?.symbol!==h.symbol||!validDate(r.date)))throw Error('history_secondary_contract');
 const today=new Date().toISOString().slice(0,10);
 const rows=body.map(r=>({date:r.date,adjustedClose:r.adjClose})).filter(r=>r.date>=h.requestedStart&&r.date<=h.requestedEnd&&r.date<today).sort((a,b)=>a.date.localeCompare(b.date));
 return {provider:'FMP',sourceUrl,symbol:h.symbol,issuerId:h.issuerId,currency:'USD',timezone:'America/New_York',retrievedAt:new Date().toISOString(),priceBasis:'split-dividend-adjusted',rawSha256:createHash('sha256').update(raw).digest('hex'),rows};
}

/** At most two parallel fixed-endpoint reads, preserving every successful witness. */
export async function acquireSecondaryEvidence(h:MarketHistory,fetcher:typeof fetch=fetch):Promise<Pick<MarketHistory,'secondary'|'secondarySupport'|'secondaryAcquisitionFailures'|'brazilEvidence'>>{
 if(process.env.PRICE_RECONCILIATION_ENABLED!=='true')return {};
 if(process.env.BRAZIL_HISTORY_NORMALIZATION_ENABLED==='true'&&h.symbol==='PETR4.SA'&&h.issuerId==='br:33000167000101')return acquireBrazilEvidence(h,fetcher);
 const providers=['configured_secondary','FMP'];
 const results=await Promise.allSettled([secondaryPrices(h,fetcher),fmpPrices(h,fetcher)]);
 const valid:SecondaryPrices[]=[],failures:{provider:string;reason:string}[]=[];
 results.forEach((result,i)=>{
  if(result.status==='fulfilled'&&result.value){reconcilePrices(h,result.value);valid.push(result.value);}
  else if(result.status==='rejected'){
   const reason=result.reason instanceof Error&&/^history_secondary_[a-z_0-9]+$/.test(result.reason.message)?result.reason.message:'history_secondary_unavailable';
   failures.push({provider:providers[i],reason});
  }
 });
 if(!valid.length&&failures.length)throw Error('history_secondary_unavailable');
 return {...(valid[0]?{secondary:valid[0]}:{}),...(valid.length>1?{secondarySupport:valid.slice(1)}:{}),...(failures.length?{secondaryAcquisitionFailures:failures}:{})};
}
