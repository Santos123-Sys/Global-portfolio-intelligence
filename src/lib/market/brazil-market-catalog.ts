import {createHash} from 'node:crypto';
import {readBoundedJson} from '../request-body';
type Listing={symbol:string;name:string;subType:'stock'|'unit';isActive:boolean};
function record(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('history_brazil_catalog_contract');return v as Record<string,unknown>;}
/** Discovery is not data certification. Never populate a portfolio or infer a CNPJ from a ticker. */
export async function brazilMarketCatalog(fetcher:typeof fetch=fetch){
 const listings:Listing[]=[],receipts:{page:number;sha256:string}[]=[],seen=new Set<string>();
 const sourceUrl='https://brapi.dev/api/v2/tickers',signal=AbortSignal.timeout(20000);let total:number|undefined;
 for(let page=1;page<=10;page++){
  const url=new URL(sourceUrl);url.search=new URLSearchParams({type:'stock',limit:'2000',page:String(page),sortBy:'symbol',sortOrder:'asc'}).toString();
  const response=await fetcher(url,{redirect:'error',cache:'no-store',headers:{accept:'application/json'},signal});
  if(!response.ok){await response.body?.cancel();throw Error('history_brazil_catalog_http_'+response.status);}
  const body=await readBoundedJson(new Request('https://response.invalid',{method:'POST',body:response.body,headers:{'content-type':response.headers.get('content-type')??''},duplex:'half'} as RequestInit),3000000);
  if(!body.ok)throw Error('history_brazil_catalog_contract');
  const data=record(body.value),pagination=record(data.pagination),rows=data.results;
  if(!Array.isArray(rows)||rows.length>2000||pagination.page!==page||typeof pagination.hasNextPage!=='boolean'||
   !Number.isSafeInteger(pagination.totalItems)||Number(pagination.totalItems)<0||Number(pagination.totalItems)>20000||
   (total!==undefined&&total!==pagination.totalItems))throw Error('history_brazil_catalog_contract');
  total=Number(pagination.totalItems);
  receipts.push({page,sha256:createHash('sha256').update(JSON.stringify(body.value)).digest('hex')});
  for(const raw of rows){
   const r=record(raw);
   if(typeof r.symbol!=='string'||!/^[A-Z]{4}\d{1,2}$/.test(r.symbol)||typeof r.name!=='string'||!r.name||r.name.length>200||
    r.assetType!=='stock'||!['stock','unit'].includes(String(r.subType))||r.exchange!=='B3'||r.currency!=='BRL'||typeof r.isActive!=='boolean'||seen.has(r.symbol))throw Error('history_brazil_catalog_contract');
   seen.add(r.symbol);listings.push({symbol:r.symbol,name:r.name,subType:r.subType==='unit'?'unit':'stock',isActive:r.isActive});
  }
  if(!pagination.hasNextPage){
   if(listings.length!==total)throw Error('history_brazil_catalog_incomplete');
   return {version:'brazil-market-catalog.v1',sourceUrl,retrievedAt:new Date().toISOString(),listings,receipts,
    limitation:'Provider-discovered ordinary/preferred shares and units. Includes returned inactive listings; delisted securities absent from the vendor catalog are not certified as covered. Discovery never establishes issuer identity or five-year data quality.'};
  }
 }
 throw Error('history_brazil_catalog_incomplete');
}
