import {brazilMarketCatalog} from '../src/lib/market/brazil-market-catalog';
import {acquireBrazilEvidence} from '../src/lib/market/brazil-evidence-provider';
import {assessHistory,historyIdentity} from '../src/lib/market/history-quality';
import type {MarketHistory} from '../src/lib/market/history-quality';
import {brazilReleaseGate,type BrazilCanaryResult} from '../src/lib/market/brazil-release-gate';
import {riskConnection} from '../src/lib/market/history-store';
import {historyEvidenceError} from '../src/lib/market/evidence-errors';
import {readBoundedJson} from '../src/lib/request-body';
import {Candidate} from '../src/lib/foundation/contracts';
import seed from '../data/usa-cvm-universe.json';
import {checkBrazilRisk} from './check-brazil-risk';

/** Bounded serial source-to-consumer sample. No account writes, repairs or retry resets. */
export async function checkBrazilMarket(fetcher:typeof fetch=fetch){
 const symbols=(process.env.BRAZIL_MARKET_CANARY_SYMBOLS??'VALE3,ITUB4,BBDC4').split(',');
 if(!symbols.length||symbols.length>8||new Set(symbols).size!==symbols.length||symbols.some(s=>!/^[A-Z][A-Z0-9]{3}\d{1,2}$/.test(s)))throw Error('history_brazil_canary_configuration');
 // Validate configuration before any provider request.
 const {base,token}=riskConnection();
 let catalogAvailable=false;
 let coverage:Record<string,unknown>;
 try{
  const catalog=await brazilMarketCatalog(fetcher);
  catalogAvailable=true;
  coverage={status:'catalog_discovered',listings:catalog.listings.length,active:catalog.listings.filter(l=>l.isActive).length,
   symbolsRequiringReview:catalog.listings.filter(l=>l.normalizationStatus==='symbol_review_required').length,
   mappedSeedListings:catalog.listings.filter(l=>seed.candidates.some(c=>c.market==='br'&&c.ticker===l.symbol&&c.issuer)).length,
   receipts:catalog.receipts,sourceUrl:catalog.sourceUrl,limitation:catalog.limitation,verified:0,notEvaluated:catalog.listings.length};
 }catch(error){coverage={status:'unavailable',reason:historyEvidenceError(error)};}
 console.log(JSON.stringify({kind:'brazil_market_coverage',...coverage}));
 const results:BrazilCanaryResult[]=[];
 for(const symbol of symbols){
  const result:BrazilCanaryResult={symbol,status:'unavailable_or_review_required',stage:'identity'};
  try{
   const candidate=seed.candidates.find(c=>c.ticker===symbol&&c.market==='br');
   if(!candidate?.issuer){result.status='issuer_mapping_required';}
   else{
    const identity=historyIdentity(Candidate.parse(candidate));
    result.stage='primary';
    const response=await fetcher(new URL('/v1/market-history',base),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},redirect:'error',cache:'no-store',body:JSON.stringify(identity),signal:AbortSignal.timeout(45000)});
    if(!response.ok){await response.body?.cancel();throw Error('history_brazil_primary_http_'+response.status);}
    const body=await readBoundedJson(new Request('https://response.invalid',{method:'POST',body:response.body,headers:{'content-type':response.headers.get('content-type')??''},duplex:'half'} as RequestInit),700000);
    if(!body.ok)throw Error('history_brazil_primary_contract');
    assessHistory(body.value,identity);const history=body.value as MarketHistory;
    result.stage='acquisition';
    const evidence=await acquireBrazilEvidence(history,fetcher);
    result.stage='assessment';
    const acquired={...history,...evidence},quality=assessHistory(acquired,identity),normalization=quality.brazilNormalization;
    Object.assign(result,{status:quality.status,normalization:normalization?.status??'absent',observations:quality.observations,
     issues:quality.issues,unresolved:normalization?.unresolved.slice(0,5)??[],unresolvedCount:normalization?.unresolved.length??0,
     sourceHashBasis:normalization?.version??history.priceBasis,consumer:'not_eligible'});
    if(quality.status==='ready'&&normalization?.status==='verified'){
     result.stage='consumer';
     const receipt=await checkBrazilRisk(acquired,base,token,fetcher);
     Object.assign(result,{consumer:'verified',sourceHash:receipt.sourceHash,snapshotId:receipt.snapshotId,stage:'complete'});
    }
   }
  }catch(error){
   result.status='unavailable_or_review_required';
   result.reason=error instanceof Error&&/^(risk_canary_[a-z_0-9]{1,80}|history_[a-z_0-9]{1,100})$/.test(error.message)?error.message:historyEvidenceError(error);
  }
  results.push(result);console.log(JSON.stringify({kind:'brazil_market_canary',...result,stateless:true}));
 }
 const gate=brazilReleaseGate(catalogAvailable,symbols,results);
 const report={version:'brazil-release.v1',generatedAt:new Date().toISOString(),sourceCommit:process.env.RAILWAY_GIT_COMMIT_SHA??process.env.GITHUB_SHA??null,
  requestedSymbols:symbols,coverage,results,gate,stateless:true};
 console.log(JSON.stringify({kind:'brazil_market_release',...report}));
 return report;
}
