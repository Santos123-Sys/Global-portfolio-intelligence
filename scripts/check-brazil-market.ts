import {brazilMarketCatalog} from '../src/lib/market/brazil-market-catalog';
import {acquireBrazilEvidence} from '../src/lib/market/brazil-evidence-provider';
import {assessHistory,historyIdentity} from '../src/lib/market/history-quality';
import type {MarketHistory} from '../src/lib/market/history-quality';
import {riskConnection} from '../src/lib/market/history-store';
import {historyEvidenceError} from '../src/lib/market/evidence-errors';
import {readBoundedJson} from '../src/lib/request-body';
import {Candidate} from '../src/lib/foundation/contracts';
import seed from '../data/usa-cvm-universe.json';
import {checkBrazilRisk} from './check-brazil-risk';
/** Full catalog discovery plus a bounded, serial, stateless release sample. Never writes account data. */
export async function checkBrazilMarket(fetcher:typeof fetch=fetch){
 const catalog=await brazilMarketCatalog(fetcher);
 console.log(JSON.stringify({kind:'brazil_market_coverage',status:'catalog_discovered',listings:catalog.listings.length,active:catalog.listings.filter(l=>l.isActive).length,receipts:catalog.receipts,sourceUrl:catalog.sourceUrl,
  limitation:catalog.limitation,verified:0,notEvaluated:catalog.listings.length}));
 const symbols=(process.env.BRAZIL_MARKET_CANARY_SYMBOLS??'VALE3,ITUB4,BBDC4').split(',');
 if(symbols.length>8||new Set(symbols).size!==symbols.length||symbols.some(s=>!/^[A-Z]{4}\d{1,2}$/.test(s)))throw Error('history_brazil_canary_configuration');
 const {base,token}=riskConnection();
 for(const symbol of symbols){
  const candidate=seed.candidates.find(c=>c.ticker===symbol&&c.market==='br');
  if(!candidate){console.log(JSON.stringify({kind:'brazil_market_canary',symbol,status:'issuer_mapping_required'}));continue;}
  try{
   const identity=historyIdentity(Candidate.parse(candidate));
   const response=await fetcher(new URL('/v1/market-history',base),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},redirect:'error',cache:'no-store',body:JSON.stringify(identity),signal:AbortSignal.timeout(45000)});
   if(!response.ok){await response.body?.cancel();throw Error('history_brazil_primary_http_'+response.status);}
   const body=await readBoundedJson(new Request('https://response.invalid',{method:'POST',body:response.body,headers:{'content-type':response.headers.get('content-type')??''},duplex:'half'} as RequestInit),700000);
   if(!body.ok)throw Error('history_brazil_primary_contract');
   assessHistory(body.value,identity);const history=body.value as MarketHistory;
   Object.assign(history,await acquireBrazilEvidence(history,fetcher));const quality=assessHistory(history,identity);
   const normalization=quality.brazilNormalization;
   let consumer='not_eligible';
   if(quality.status==='ready'&&normalization?.status==='verified'){
    await checkBrazilRisk(history,base,token,fetcher);consumer='verified';
   }
   console.log(JSON.stringify({kind:'brazil_market_canary',symbol,status:quality.status,normalization:normalization?.status??'absent',observations:quality.observations,
    unresolved:normalization?.unresolved??[],sourceHashBasis:normalization?.version??history.priceBasis,consumer,stateless:true}));
  }catch(error){console.log(JSON.stringify({kind:'brazil_market_canary',symbol,status:'unavailable_or_review_required',reason:historyEvidenceError(error),stateless:true}));}
 }
}
