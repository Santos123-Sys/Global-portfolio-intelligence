import { SecurityUniverseRecord, type SecurityUniverseRecord as SecurityUniverseRecordType } from '@portfolio-intelligence/agentic-contract';
import { and, eq, gt } from 'drizzle-orm';
import { db } from './db';
import { discoveryUniverseSnapshots } from './db/workflow-schema';
import { getEnv } from './env';
import { FmpProvider } from './connectors/fmp';
import { getProviderGateway } from './services/provider-gateway';
import { mergeResearchUniverse } from './research-universe';

export interface MarketDiscoveryProvider {
  readonly name: 'brapi' | 'fmp' | 'finnhub';
  getSecurityUniverse(exchange: string, limit: number): Promise<SecurityUniverseRecordType[]>;
}
const EXCHANGE_INFO:Record<string,{finnhubCode:string;currency:string;country:string}>={XSWX:{finnhubCode:'SW',currency:'CHF',country:'Switzerland'},BVMF:{finnhubCode:'SA',currency:'BRL',country:'Brazil'}};
const marketLabel=(exchange:string)=>exchange==='BVMF'?'Brazilian B3 market (BVMF)':exchange==='XSWX'?'Swiss SIX market (XSWX)':exchange;
const errorMessage=(error:unknown)=>error instanceof Error?error.message:'Unknown provider error';
const NON_EQUITY=['etf','fund','bond','index','currency','warrant','right'];
function finite(value:unknown):number|undefined{if(value===null||value===undefined||value==='')return undefined;const n=typeof value==='number'?value:Number(value);return Number.isFinite(n)?n:undefined;}
function toRecord(row:Record<string,unknown>,exchange:string):SecurityUniverseRecordType|null{
  const info=EXCHANGE_INFO[exchange];const symbol=typeof row.symbol==='string'?row.symbol.trim():'';const companyName=typeof row.description==='string'?row.description.trim():'';const assetType=typeof row.type==='string'&&row.type.trim()?row.type:'Listed Equity';
  if(!info||!symbol||!companyName||NON_EQUITY.some(item=>assetType.toLowerCase().includes(item)))return null;
  const ticker=symbol.replace(/\.(SW|SA)$/i,'').toUpperCase();const attributes:SecurityUniverseRecordType['attributes']={provider_symbol:symbol};
  if(typeof row.mic==='string')attributes.provider_mic=row.mic;if(typeof row.figi==='string')attributes.figi=row.figi;if(typeof row.isin==='string')attributes.isin=row.isin;
  const marketCap=finite(row.marketCapitalization??row.market_capitalization);if(marketCap!=null)attributes.market_capitalization=marketCap;
  return{ticker,exchange,companyName,currency:typeof row.currency==='string'&&row.currency?row.currency:info.currency,country:info.country,sector:typeof row.sector==='string'?row.sector:null,industry:typeof row.industry==='string'?row.industry:null,assetType,observedAt:new Date().toISOString(),provider:'finnhub',sourceUrl:'https://finnhub.io/docs/api/stock-symbols',attributes};
}

export class FinnhubDiscoveryProvider implements MarketDiscoveryProvider{
  readonly name='finnhub' as const;constructor(private readonly apiKey:string){}
  async getSecurityUniverse(exchange:string,limit:number):Promise<SecurityUniverseRecordType[]>{
    const info=EXCHANGE_INFO[exchange];if(!info)throw new Error(`Finnhub exchange mapping is not configured for ${exchange}`);
    const endpoint='/api/v1/stock/symbol';const raw=await getProviderGateway().run({provider:this.name,endpoint,perform:async()=>{const url=new URL(`https://finnhub.io${endpoint}`);url.searchParams.set('exchange',info.finnhubCode);url.searchParams.set('token',this.apiKey);const response=await fetch(url,{headers:{accept:'application/json'}});if(!response.ok)throw new Error(`Finnhub stock-symbol request failed: ${response.status} ${response.statusText}`);return response.json();},classify:()=>({outcome:'ok',httpStatus:200})});
    if(!Array.isArray(raw))throw new Error(`Finnhub returned an invalid symbol list for ${exchange}`);
    const unique=[...new Map(raw.flatMap(value=>value&&typeof value==='object'?[toRecord(value as Record<string,unknown>,exchange)]:[]).filter((value):value is SecurityUniverseRecordType=>value!==null).map(record=>[`${record.exchange}:${record.ticker}`,record])).values()];
    const selected=unique.slice(0,Math.max(1,Math.min(limit,4000)));return selected.map(record=>({...record,attributes:{...record.attributes,universe_truncated:unique.length>selected.length,universe_ranking:'unranked',universe_eligible_count:unique.length,universe_selected_count:selected.length,listing_country:info.country}}));
  }
}

type BrapiListResponse={stocks?:unknown[];totalPages?:unknown;totalCount?:unknown;hasNextPage?:unknown};
function brapiRecord(row:Record<string,unknown>):SecurityUniverseRecordType|null{
  const ticker=typeof row.stock==='string'?row.stock.trim().toUpperCase():'';const companyName=typeof row.name==='string'?row.name.trim():'';const assetType=typeof row.type==='string'&&row.type.trim()?row.type.trim():'stock';const subType=typeof row.subType==='string'?row.subType.trim().toLowerCase():'';
  if(!ticker||!companyName||assetType.toLowerCase()!=='stock'||(subType&&!['stock','unit'].includes(subType)))return null;
  const attributes:SecurityUniverseRecordType['attributes']={provider_symbol:ticker,listing_country:'Brazil'};const close=finite(row.close),change=finite(row.change),volume=finite(row.volume),marketCap=finite(row.market_cap??row.marketCap);if(close!=null)attributes.latest_close=close;if(change!=null)attributes.day_change_percent=change;if(volume!=null)attributes.regular_market_volume=volume;if(marketCap!=null)attributes.market_capitalization=marketCap;if(subType)attributes.listing_subtype=subType;
  return{ticker,exchange:'BVMF',companyName,currency:'BRL',country:'Brazil',sector:typeof row.sector==='string'&&row.sector.trim()?row.sector.trim():null,industry:null,assetType:subType||assetType,observedAt:new Date().toISOString(),provider:'brapi',sourceUrl:'https://brapi.dev/docs/acoes/list',attributes};
}
export class BrapiDiscoveryProvider implements MarketDiscoveryProvider{
  readonly name='brapi' as const;constructor(private readonly apiKey:string){}
  async getSecurityUniverse(exchange:string,limit:number):Promise<SecurityUniverseRecordType[]>{
    if(exchange!=='BVMF')throw new Error(`BrAPI only supports the Brazilian B3 universe, not ${exchange}`);const capped=Math.max(1,Math.min(limit,4000)),pageSize=Math.min(100,capped);const records:SecurityUniverseRecordType[]=[];let page=1,totalCount:number|null=null,hasNext=true;
    while(hasNext&&records.length<capped){const payload=await getProviderGateway().run({provider:this.name,endpoint:'/api/quote/list',perform:async()=>{const url=new URL('https://brapi.dev/api/quote/list');url.searchParams.set('type','stock');url.searchParams.set('page',String(page));url.searchParams.set('limit',String(pageSize));const response=await fetch(url,{headers:{accept:'application/json',authorization:`Bearer ${this.apiKey}`},signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`BrAPI B3 listing request failed: ${response.status} ${response.statusText}`);return response.json() as Promise<BrapiListResponse>;},classify:()=>({outcome:'ok',httpStatus:200})});const rows=Array.isArray(payload.stocks)?payload.stocks:[];records.push(...rows.flatMap(value=>value&&typeof value==='object'?[brapiRecord(value as Record<string,unknown>)]:[]).filter((value):value is SecurityUniverseRecordType=>value!==null));const reportedTotal=finite(payload.totalCount);if(reportedTotal!=null)totalCount=reportedTotal;const pages=finite(payload.totalPages);hasNext=payload.hasNextPage===true||(pages!=null&&page<pages);if(!rows.length)hasNext=false;page++;}
    const unique=[...new Map(records.map(record=>[`${record.exchange}:${record.ticker}`,record])).values()],selected=unique.slice(0,capped),eligible=totalCount??unique.length;return selected.map(record=>({...record,attributes:{...record.attributes,universe_truncated:eligible>selected.length,universe_ranking:'unranked',universe_eligible_count:eligible,universe_selected_count:selected.length}}));
  }
}
class FmpDiscoveryProvider implements MarketDiscoveryProvider{readonly name='fmp' as const;constructor(private readonly provider:FmpProvider){}getSecurityUniverse(exchange:string,limit:number){return this.provider.getSecurityUniverse(exchange,limit);}}

export function getDiscoveryProvider(exchange?:string):MarketDiscoveryProvider{
  const env=getEnv();if(exchange==='BVMF'&&env.BRAPI_API_KEY)return new BrapiDiscoveryProvider(env.BRAPI_API_KEY);
  if(env.DISCOVERY_PROVIDER==='finnhub'){if(!env.FINNHUB_API_KEY)throw new Error('FINNHUB_API_KEY is required when DISCOVERY_PROVIDER=finnhub');return new FinnhubDiscoveryProvider(env.FINNHUB_API_KEY);}
  if(!env.FMP_API_KEY)throw new Error('FMP_API_KEY is required when DISCOVERY_PROVIDER=fmp');return new FmpDiscoveryProvider(new FmpProvider(env.FMP_API_KEY,getProviderGateway()));
}

/** Only the bounded, eligible research queue gets issuer-profile calls. */
export async function enrichDiscoveryIssuerSources(records:SecurityUniverseRecordType[]):Promise<SecurityUniverseRecordType[]>{
  const env=getEnv();const fmp=env.FMP_API_KEY?new FmpProvider(env.FMP_API_KEY,getProviderGateway()):null;const enriched=[...records];let cursor=0;
  await Promise.all(Array.from({length:Math.min(8,records.length)},async()=>{while(cursor<records.length){const index=cursor++,record=records[index];if(typeof record.attributes.issuer_website==='string')continue;try{let profile:{name?:string|null;isin?:string|null;website?:string|null}|null=null;if(record.provider==='fmp'&&fmp)profile=await fmp.getDiscoveryIssuerProfile(record.ticker,record.exchange);else if(record.provider==='finnhub'&&env.FINNHUB_API_KEY){const url=new URL('https://finnhub.io/api/v1/stock/profile2');url.searchParams.set('symbol',String(record.attributes.provider_symbol??record.ticker));const response=await fetch(url,{signal:AbortSignal.timeout(8000),headers:{'X-Finnhub-Token':env.FINNHUB_API_KEY}});if(response.ok){const raw=await response.json() as Record<string,unknown>;profile={name:typeof raw.name==='string'?raw.name:'',website:typeof raw.weburl==='string'?raw.weburl:''};}}if(!profile?.website)continue;const source=new URL(profile.website);if(source.protocol!=='https:'||source.username||source.password||(source.port&&source.port!=='443'))continue;const normalize=(name:string)=>name.toLowerCase().replace(/[^a-z0-9]/g,'');const sameIssuer=(profile.isin&&profile.isin===record.attributes.isin)||(profile.name&&normalize(profile.name)===normalize(record.companyName));if(!sameIssuer)continue;enriched[index]={...record,attributes:{...record.attributes,issuer_website:source.href,issuer_website_provider:record.provider,issuer_profile_name:profile.name??null}};}catch{/* source unavailable; downstream records the gap */}}}));return enriched;
}
async function cachedUniverse(provider:string,exchange:string):Promise<SecurityUniverseRecordType[]|null>{const[snapshot]=await db.select().from(discoveryUniverseSnapshots).where(and(eq(discoveryUniverseSnapshots.provider,provider),eq(discoveryUniverseSnapshots.exchange,exchange),gt(discoveryUniverseSnapshots.expiresAt,new Date()))).limit(1);if(!snapshot)return null;const parsed=SecurityUniverseRecord.array().safeParse(snapshot.recordsJson);return parsed.success?parsed.data:null;}
async function saveUniverse(provider:string,exchange:string,records:SecurityUniverseRecordType[]):Promise<void>{const hours=getEnv().DISCOVERY_UNIVERSE_CACHE_HOURS;await db.insert(discoveryUniverseSnapshots).values({provider,exchange,recordsJson:records,expiresAt:new Date(Date.now()+hours*3600000)}).onConflictDoUpdate({target:[discoveryUniverseSnapshots.provider,discoveryUniverseSnapshots.exchange],set:{recordsJson:records,fetchedAt:new Date(),expiresAt:new Date(Date.now()+hours*3600000)}});}
export async function loadDiscoveryUniverse(exchange:string,limit:number):Promise<{records:SecurityUniverseRecordType[];provider:string;cached:boolean}>{
  const env=getEnv();const primaryName=exchange==='BVMF'&&env.BRAPI_API_KEY?'brapi':env.DISCOVERY_PROVIDER;let primaryError:unknown;
  try{const primary=getDiscoveryProvider(exchange);const records=await primary.getSecurityUniverse(exchange,limit);if(!records.length)throw new Error(`${primary.name} returned an empty security universe`);await saveUniverse(primary.name,exchange,records);return{records:mergeResearchUniverse(records,exchange),provider:primary.name,cached:false};}catch(error){primaryError=error;}
  try{const cached=await cachedUniverse(primaryName,exchange);if(cached?.length)return{records:mergeResearchUniverse(cached.slice(0,limit),exchange),provider:primaryName,cached:true};}catch{/* cache failure must not prevent fallback */}
  if(env.DISCOVERY_FALLBACK_PROVIDER==='fmp'&&primaryName!=='fmp'){
    if(!env.FMP_API_KEY)throw new Error(`${marketLabel(exchange)} could not be loaded from ${primaryName}: ${errorMessage(primaryError)}. FMP fallback is enabled but FMP_API_KEY is not configured on the dashboard service.`);
    const fallback=new FmpDiscoveryProvider(new FmpProvider(env.FMP_API_KEY,getProviderGateway()));try{const records=await fallback.getSecurityUniverse(exchange,limit);if(!records.length)throw new Error('FMP returned an empty security universe');await saveUniverse(fallback.name,exchange,records);return{records:mergeResearchUniverse(records,exchange),provider:fallback.name,cached:false};}catch(fallbackError){throw new Error(`${marketLabel(exchange)} could not be loaded. ${primaryName}: ${errorMessage(primaryError)}. FMP fallback: ${errorMessage(fallbackError)}`);}
  }
  throw new Error(`${marketLabel(exchange)} could not be loaded from ${primaryName}: ${errorMessage(primaryError)}`);
}
