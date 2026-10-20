import {reconcilePrices,type SecondaryPrices} from './price-reconciliation';
/** Portable deterministic contract shared by GPI and the Risk Studio function. */
import type {Candidate} from '../foundation/contracts';
export function historyIdentity(c:Candidate) {
  if(!c.issuer)throw Error('issuer_unmapped');
  return {candidateKey:c.key,issuerId:c.issuer.jurisdiction+':'+c.issuer.registryId,
    symbol:c.market==='br'?c.ticker+'.SA':c.ticker};
}
export type PriceRow = {date:string;close:number;adjustedClose:number;volume:number};
export type MarketHistory = {
  secondary?:SecondaryPrices;
  schemaVersion:'market-history.v1';symbol:string;issuerId:string;currency:'USD'|'BRL';
  exchange:string;timezone:string;provider:'Yahoo Finance (unofficial)';sourceUrl:string;
  retrievedAt:string;requestedStart:string;requestedEnd:string;priceBasis:'vendor-adjusted-close';
  rows:PriceRow[];reference:{symbol:string;dates:string[];sourceUrl?:string};
  corporateActions:{date:string;kind:'dividend'|'split';value:number}[];
};
const day=86400000;
export function validDate(v:unknown):v is string {
  return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
}
export function fiveYearStart(end:string) {
  if(!validDate(end))throw Error('invalid_history_date');
  const d=new Date(end);const month=d.getUTCMonth();d.setUTCFullYear(d.getUTCFullYear()-5);
  if(d.getUTCMonth()!==month)d.setUTCDate(0);
  return d.toISOString().slice(0,10);
}
export function canonical(value:unknown):string {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
}
export async function historyHash(value:unknown) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
}
export function assessHistory(raw:unknown,expected:{symbol:string;issuerId:string},now=Date.now()) {
  const h=raw as MarketHistory;
  if(!h||h.schemaVersion!=='market-history.v1'||h.symbol!==expected.symbol||h.issuerId!==expected.issuerId||
    !/^(us:\d{10}|br:\d{14})$/.test(h.issuerId)||!/^([A-Z0-9.-]{1,15})$/.test(h.symbol)||
    h.provider!=='Yahoo Finance (unofficial)'||h.priceBasis!=='vendor-adjusted-close')throw Error('history_identity_or_basis_invalid');
  const brazil=h.issuerId.startsWith('br:');
  if(h.currency!==(brazil?'BRL':'USD')||brazil!==h.symbol.endsWith('.SA')||
    !(brazil?['SAO']:['NMS','NYQ','NGM','NCM','ASE','PCX','BTS']).includes(h.exchange)||
    h.timezone!==(brazil?'America/Sao_Paulo':'America/New_York'))throw Error('history_listing_invalid');
  const source=new URL(h.sourceUrl);
  if(source.protocol!=='https:'||!['query1.finance.yahoo.com','query2.finance.yahoo.com'].includes(source.hostname)||
    source.pathname!=='/v8/finance/chart/'+encodeURIComponent(h.symbol)||source.username||source.password||source.hash||source.search)throw Error('history_source_invalid');
  if(!validDate(h.requestedEnd)||h.requestedStart!==fiveYearStart(h.requestedEnd)||
    Date.parse(h.requestedEnd)>now||now-Date.parse(h.requestedEnd)>8*day||
    !Number.isFinite(Date.parse(h.retrievedAt))||Date.parse(h.retrievedAt)>now+30000||now-Date.parse(h.retrievedAt)>8*day)throw Error('history_stale');
  if(!Array.isArray(h.rows)||h.rows.length<2||h.rows.length>1500||!Array.isArray(h.reference?.dates)||
    h.reference.dates.length<1100||h.reference.dates.length>1500||!(brazil?['BOVA11.SA','^BVSP']:['SPY']).includes(h.reference.symbol))throw Error('history_coverage_invalid');
  if(h.reference.symbol==='^BVSP'&&!['https://query1.finance.yahoo.com/v8/finance/chart/%5EBVSP','https://query2.finance.yahoo.com/v8/finance/chart/%5EBVSP'].includes(h.reference.sourceUrl??''))throw Error('history_reference_source_invalid');
  const ordered=(dates:string[])=>dates.every((d,i)=>validDate(d)&&d>=h.requestedStart&&d<=h.requestedEnd&&(!i||d>dates[i-1]));
  if(!ordered(h.reference.dates)||!ordered(h.rows.map(r=>r.date))||h.rows.some(r=>
    !Number.isFinite(r.close)||r.close<=0||!Number.isFinite(r.adjustedClose)||r.adjustedClose<=0||
    !Number.isSafeInteger(r.volume)||r.volume<0))throw Error('history_rows_invalid');
  if(!Array.isArray(h.corporateActions)||h.corporateActions.length>500||h.corporateActions.some(a=>
    !validDate(a.date)||a.date<h.requestedStart||a.date>h.requestedEnd||!['split','dividend'].includes(a.kind)||!Number.isFinite(a.value)||a.value<=0))throw Error('history_actions_invalid');
  const reference=new Set(h.reference.dates),observed=new Set(h.rows.map(r=>r.date));
  const first=h.rows[0].date,last=h.rows.at(-1)!.date;
  const missing=h.reference.dates.filter(d=>d>=first&&d<=last&&!observed.has(d));
  const unexpected=h.rows.filter(r=>!reference.has(r.date)).length;
  const issues:string[]=[];
  if(missing.length)issues.push('missing_sessions');
  if(unexpected)issues.push('unexpected_sessions');
  if(last!==h.reference.dates.at(-1)||now-Date.parse(last)>8*day)issues.push('stale_last_session');
  if(Date.parse(h.reference.dates[0])-Date.parse(h.requestedStart)>10*day)issues.push('reference_window_incomplete');
  const shortHistory=Date.parse(first)-Date.parse(h.requestedStart)>10*day;
  const referenceIndex=new Map(h.reference.dates.map((d,i)=>[d,i]));
  const returns=h.rows.map((r,i)=>{
    const p=h.rows[i-1];const adjacent=p&&referenceIndex.has(r.date)&&referenceIndex.get(r.date)===referenceIndex.get(p.date)!+1;
    return {date:r.date,simpleReturn:adjacent?r.adjustedClose/p.adjustedClose-1:null,logReturn:adjacent?Math.log(r.adjustedClose/p.adjustedClose):null};
  });
  const daily=returns.flatMap(r=>r.simpleReturn===null?[]:[r.simpleReturn]);
  if(daily.some(r=>Math.abs(r)>.5))issues.push('extreme_return_review');
  const reconciliation=reconcilePrices(h,h.secondary,now);
  if(['incomplete','disputed'].includes(reconciliation.status))issues.push('independent_price_'+reconciliation.status);
  const status=issues.length?'quarantined':shortHistory?'short_history':'ready';
  const mean=daily.reduce((s,v)=>s+v,0)/daily.length;
  const variance=daily.reduce((s,v)=>s+(v-mean)**2,0)/(daily.length-1);
  let peak=0,drawdown=0;for(const r of h.rows){peak=Math.max(peak,r.adjustedClose);drawdown=Math.min(drawdown,r.adjustedClose/peak-1);}
  const sorted=[...daily].sort((a,b)=>a-b),q=sorted[Math.floor((sorted.length-1)*.05)],tail=sorted.filter(r=>r<=q);
  return {version:'history-quality.v1' as const,status,issues,reconciliation,firstDate:first,lastDate:last,observations:h.rows.length,
    expectedSessions:h.reference.dates.length,missingSessions:missing,returns,
    metrics:status==='ready'?{annualizedVolatility:Math.sqrt(variance*252),maxDrawdown:drawdown,
      historicalVar95:Math.max(0,-q),historicalCvar95:Math.max(0,-tail.reduce((s,v)=>s+v,0)/tail.length),
      cumulativeReturn:h.rows.at(-1)!.adjustedClose/h.rows[0].adjustedClose-1}:null,
    methodology:'Vendor-adjusted simple/log daily returns; 252-session sample volatility; historical daily VaR/CVaR at 95%; no gap filling. Reference index/ETF sessions are a coverage proxy, not an official exchange calendar.',
    limitations:[reconciliation.status==='matched'?'Second-provider adjusted prices match within configured tolerances; vendor upstream independence is not certified.':'Independent price reconciliation has not passed; this dataset is not independently verified.','Provider adjustments are retained, not independently certified.','Short histories and quarantined series cannot feed the five-year risk calculation.']};
}
