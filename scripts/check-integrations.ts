import {financeForCandidate} from '../src/lib/foundation/runner';
import {assessHistory} from '../src/lib/market/history-quality';
import {riskConnection} from '../src/lib/market/history-store';
import seed from '../data/usa-cvm-universe.json';
import {Candidate} from '../src/lib/foundation/contracts';
import {readBoundedJson} from '../src/lib/request-body';

/** Read-only startup canary. Never invokes a model or writes user workspace data. */
export async function checkIntegrations(){
 const candidate=Candidate.parse(seed.candidates.find(c=>c.ticker==='AAPL'));
 const finance=await financeForCandidate(candidate);
 console.log(JSON.stringify({kind:'integration_check',integration:'FilingLens',status:finance.status,
  ...(finance.status==='ready'?{facts:finance.snapshot.facts.length}:{reason:finance.reason})}));
 if(process.env.MARKET_HISTORY_ENABLED!=='true')return;
 try{
  const {base,token}=riskConnection(),identity={symbol:'AAPL',issuerId:'us:0000320193'};
  const r=await fetch(new URL('/v1/market-history',base),{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(identity),signal:AbortSignal.timeout(45000)});
  if(!r.ok){await r.body?.cancel();throw Error('provider_http_'+r.status);}
  const body=await readBoundedJson(new Request('https://response.invalid',{method:'POST',body:r.body,headers:{'content-type':r.headers.get('content-type')??''},duplex:'half'} as RequestInit),700000);
  if(!body.ok)throw Error('invalid_response');const q=assessHistory(body.value,identity);
  console.log(JSON.stringify({kind:'integration_check',integration:'market_history',status:q.status,observations:q.observations,firstDate:q.firstDate,lastDate:q.lastDate}));
 }catch{console.error(JSON.stringify({kind:'integration_check',integration:'market_history',status:'unavailable'}));}
}
