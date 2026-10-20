import {historyHash,assessHistory,type MarketHistory} from '../src/lib/market/history-quality';
import {readBoundedJson} from '../src/lib/request-body';
/** Stateless synthetic holding of a public instrument; no account/workspace writes. */
export async function checkBrazilRisk(h:MarketHistory,base:URL,token:string,fetcher:typeof fetch=fetch){
 const q=assessHistory(h,h);if(q.status!=='ready'||q.brazilNormalization?.status!=='verified')throw Error('risk_canary_history_blocked');
 const sourceHash=await historyHash(h),snapshotId='mh1_'+sourceHash;
 const response=await fetcher(new URL('/v1/portfolio-analyze',base),{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},signal:AbortSignal.timeout(45000),body:JSON.stringify({workspaceId:crypto.randomUUID(),portfolioId:crypto.randomUUID(),runId:crypto.randomUUID(),positions:[{symbol:h.symbol,shares:1}],issuers:[{symbol:h.symbol,issuerId:h.issuerId}],valuations:[],baseCurrency:'BRL',riskFreeRate:0,range:'5y',confirmed:true,marketHistories:[{history:h,sourceHash,snapshotId}]})});
 if(!response.ok){await response.body?.cancel();throw Error('risk_canary_http_'+response.status);}
 const body=await readBoundedJson(new Request('https://response.invalid',{method:'POST',body:response.body,headers:{'content-type':'application/json'},duplex:'half'} as RequestInit),1500000);
 const r=body.ok?body.value as {schemaVersion?:string;baseCurrency?:string;historySnapshots?:{symbol:string;snapshotId:string;sourceHash:string}[];sources?:{symbol:string;priceBasis:string}[];metrics?:{volatility:number;var95:number}}:null;
 if(r?.schemaVersion!=='portfolio-analysis.v1'||r.baseCurrency!=='BRL'||r.historySnapshots?.length!==1||r.historySnapshots[0].snapshotId!==snapshotId||r.historySnapshots[0].sourceHash!==sourceHash||r.historySnapshots[0].symbol!==h.symbol||!r.sources?.some(s=>s.symbol===h.symbol&&s.priceBasis==='brazil-gross-entitlement.v1')||!Number.isFinite(r.metrics?.volatility))throw Error('risk_canary_contract');
 return {status:'verified',symbol:h.symbol,snapshotId,sourceHash,volatility:r.metrics!.volatility,stateless:true};
}
