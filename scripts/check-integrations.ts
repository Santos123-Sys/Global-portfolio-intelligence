import {financeForCandidate} from '../src/lib/foundation/runner';
import {assessHistory,historyIdentity} from '../src/lib/market/history-quality';
import {riskConnection} from '../src/lib/market/history-store';
import seed from '../data/usa-cvm-universe.json';
import {Candidate} from '../src/lib/foundation/contracts';
import {readBoundedJson} from '../src/lib/request-body';

/** Read-only startup canary. Never invokes a model or writes user workspace data. */
export async function checkIntegrations(){
 if(process.env.FINNHUB_API_KEY){
  try{
   const url=new URL('https://api.finnhub.io/api/v1/stock/candle');
   const end=new Date(),start=new Date(end);start.setUTCFullYear(start.getUTCFullYear()-5);
   url.search=new URLSearchParams({symbol:'AAPL',resolution:'D',from:String(Math.floor(start.getTime()/1000)),to:String(Math.floor(end.getTime()/1000)),token:process.env.FINNHUB_API_KEY}).toString();
   const response=await fetch(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)});
   const status=response.status;
   if(!response.ok){await response.body?.cancel();console.log(JSON.stringify({kind:'integration_check',integration:'secondary_history_access',provider:'Finnhub',httpStatus:status,status:'unavailable'}));}
   else{const body=await readBoundedJson(new Request('https://response.invalid',{method:'POST',body:response.body,headers:{'content-type':response.headers.get('content-type')??''},duplex:'half'} as RequestInit),2000000);
    const value=body.ok?body.value as {s?:string;t?:unknown[]}:null;
    console.log(JSON.stringify({kind:'integration_check',integration:'secondary_history_access',provider:'Finnhub',httpStatus:status,status:value?.s==='ok'&&Array.isArray(value.t)?'available_requires_basis_validation':'unavailable',observations:Array.isArray(value?.t)?value.t.length:0}));}
  }catch{console.log(JSON.stringify({kind:'integration_check',integration:'secondary_history_access',provider:'Finnhub',status:'unavailable'}));}
 }

 for(const ticker of ['AAPL','PETR4']){
 const candidate=Candidate.parse(seed.candidates.find(c=>c.ticker===ticker));
 const finance=await financeForCandidate(candidate);
 console.log(JSON.stringify({kind:'integration_check',integration:'FilingLens',symbol:ticker,status:finance.status,
  ...(finance.status==='ready'?{facts:finance.snapshot.facts.length}:{reason:finance.reason})}));
 if(process.env.MARKET_HISTORY_ENABLED!=='true')return;
 try{
  const {base,token}=riskConnection(),identity=historyIdentity(candidate);
  const r=await fetch(new URL('/v1/market-history',base),{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(identity),signal:AbortSignal.timeout(45000)});
  if(!r.ok){await r.body?.cancel();throw Error('provider_http_'+r.status);}
  const body=await readBoundedJson(new Request('https://response.invalid',{method:'POST',body:r.body,headers:{'content-type':r.headers.get('content-type')??''},duplex:'half'} as RequestInit),700000);
  if(!body.ok)throw Error('invalid_response');const q=assessHistory(body.value,identity);
  console.log(JSON.stringify({kind:'integration_check',integration:'market_history',symbol:ticker,status:q.status,observations:q.observations,firstDate:q.firstDate,lastDate:q.lastDate}));
 }catch{console.error(JSON.stringify({kind:'integration_check',integration:'market_history',symbol:ticker,status:'unavailable'}));}
 }
}
