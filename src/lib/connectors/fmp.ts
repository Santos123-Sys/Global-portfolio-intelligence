import type { SecurityUniverseRecord } from '@portfolio-intelligence/agentic-contract';
import type { DailyBar, Fundamentals, FundamentalsRequestOptions, PriceProvider } from './base';
import { passthroughGateway, type CallResult, type RequestGateway } from './gateway';

const BASE_URL='https://financialmodelingprep.com/stable/';
const DOCS_URL='https://site.financialmodelingprep.com/developer/docs';
type JsonRecord=Record<string,unknown>;
const EXCHANGE_MAP:Record<string,{fmp:string;suffix:string;currency:string;country:string}>={
  XSWX:{fmp:'SIX',suffix:'.SW',currency:'CHF',country:'Switzerland'},BVMF:{fmp:'SAO',suffix:'.SA',currency:'BRL',country:'Brazil'},
  XNYS:{fmp:'NYSE',suffix:'',currency:'USD',country:'United States'},XNAS:{fmp:'NASDAQ',suffix:'',currency:'USD',country:'United States'},
};
const text=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim():null;
const finite=(value:unknown)=>{const parsed=typeof value==='number'?value:typeof value==='string'?Number(value):NaN;return Number.isFinite(parsed)?parsed:null;};
const rows=(value:unknown):JsonRecord[]=>Array.isArray(value)?value.filter(row=>row&&typeof row==='object') as JsonRecord[]:[];
const firstRow=(value:unknown):JsonRecord=>rows(value)[0]??{};
const normalizeTicker=(symbol:string)=>symbol.trim().toUpperCase().replace(/\.(SW|SA)$/i,'');
function providerSymbol(ticker:string,exchange:string){const normalized=ticker.trim().toUpperCase();return /\.(SW|SA)$/i.test(normalized)?normalized:`${normalized}${EXCHANGE_MAP[exchange]?.suffix??''}`;}
function micFromExchange(exchange:string|null,symbol:string){const value=(exchange??'').toUpperCase();if(value.includes('SIX')||/\.SW$/i.test(symbol))return'XSWX';if(value.includes('SAO')||value.includes('B3')||/\.SA$/i.test(symbol))return'BVMF';if(value.includes('NEW YORK')||value.includes('NYSE'))return'XNYS';if(value.includes('NASDAQ'))return'XNAS';return value||'OTHER';}
const countryFor=(exchange:string)=>EXCHANGE_MAP[exchange]?.country??'Unknown';
const classify=(response:Response):CallResult=>response.ok?{outcome:'ok',httpStatus:response.status}:response.status===429?{outcome:'rate_limited',httpStatus:response.status}:{outcome:'error',httpStatus:response.status};
function sourceUrl(path:string,params:Record<string,string>){const url=new URL(path.replace(/^\//,''),BASE_URL);for(const[key,value]of Object.entries(params))url.searchParams.set(key,value);return url.toString();}

export interface FmpSearchResult{symbol:string;ticker:string;companyName:string;exchange:string;currency:string;country:string;}
export interface FmpProfile extends FmpSearchResult{sector:string|null;industry:string|null;isin:string|null;website:string|null;marketCap:number|null;price:number|null;}
export interface FmpFinancialPeriod{date:string;fiscalYear:string|null;period:string|null;currency:string;metrics:Record<string,number>;sourceUrl:string;}
export class FmpRequestError extends Error{constructor(readonly status:number,readonly endpoint:string){super(status===401?'Financial Modeling Prep rejected FMP_API_KEY (401). Check the dashboard service secret and redeploy.':status===429?'Financial Modeling Prep rate limit reached (429). Retry after the provider window resets.':`Financial Modeling Prep request failed (${status}) for ${endpoint}.`);this.name='FmpRequestError';}}

/** FMP is the cross-market price, company-resolution and structured-financial provider. */
export class FmpProvider implements PriceProvider{
  readonly name='fmp';readonly supportedExchanges=Object.keys(EXCHANGE_MAP);
  constructor(private readonly apiKey:string,private readonly gateway:RequestGateway=passthroughGateway){if(!apiKey.trim())throw new Error('FMP_API_KEY is required for Financial Modeling Prep');}
  private async request(path:string,params:Record<string,string>={},timeoutMs=30000):Promise<unknown>{
    const url=new URL(path.replace(/^\//,''),BASE_URL);for(const[key,value]of Object.entries(params))url.searchParams.set(key,value);url.searchParams.set('apikey',this.apiKey);const endpoint=`/${path.replace(/^\//,'')}`;
    const response=await this.gateway.run({provider:this.name,endpoint,perform:()=>fetch(url,{cache:'no-store',signal:AbortSignal.timeout(timeoutMs),headers:{accept:'application/json'}}),classify});
    if(!response.ok)throw new FmpRequestError(response.status,endpoint);return response.json();
  }
  async searchCompanies(query:string,limit=10):Promise<FmpSearchResult[]>{
    const needle=query.trim();if(!needle)return[];const bounded=String(Math.max(1,Math.min(limit,25)));
    const[symbolRows,nameRows]=await Promise.all([this.request('/search-symbol',{query:needle,limit:bounded},12000).catch(()=>[]),this.request('/search-name',{query:needle,limit:bounded},12000).catch(()=>[])]);
    const unique=new Map<string,FmpSearchResult>();for(const row of[...rows(symbolRows),...rows(nameRows)]){const symbol=text(row.symbol),companyName=text(row.name??row.companyName);if(!symbol||!companyName)continue;const exchange=micFromExchange(text(row.exchange??row.exchangeFullName),symbol);unique.set(`${exchange}:${symbol.toUpperCase()}`,{symbol,ticker:normalizeTicker(symbol),companyName,exchange,currency:text(row.currency)??EXCHANGE_MAP[exchange]?.currency??'USD',country:countryFor(exchange)});}
    const exact=needle.toUpperCase();return[...unique.values()].sort((a,b)=>Number(b.symbol.toUpperCase()===exact||b.ticker===exact)-Number(a.symbol.toUpperCase()===exact||a.ticker===exact)).slice(0,Number(bounded));
  }
  async getCompanyProfile(symbolOrTicker:string,exchange?:string):Promise<FmpProfile|null>{
    const symbol=exchange?providerSymbol(symbolOrTicker,exchange):symbolOrTicker.trim().toUpperCase();const row=firstRow(await this.request('/profile',{symbol},12000));const returnedSymbol=text(row.symbol)??symbol,companyName=text(row.companyName);if(!companyName)return null;const mic=micFromExchange(text(row.exchange??row.exchangeFullName),returnedSymbol);
    return{symbol:returnedSymbol,ticker:normalizeTicker(returnedSymbol),companyName,exchange:mic,currency:text(row.currency)??EXCHANGE_MAP[mic]?.currency??'USD',country:text(row.country)??countryFor(mic),sector:text(row.sector),industry:text(row.industry),isin:text(row.isin),website:text(row.website),marketCap:finite(row.marketCap),price:finite(row.price)};
  }
  async resolveCompany(query:string):Promise<FmpProfile|null>{const matches=await this.searchCompanies(query,12);for(const match of matches.slice(0,5)){const profile=await this.getCompanyProfile(match.symbol).catch(()=>null);if(profile)return profile;}return null;}
  async getDiscoveryIssuerProfile(ticker:string,exchange:string){const profile=await this.getCompanyProfile(ticker,exchange);return profile?{name:profile.companyName,isin:profile.isin,website:profile.website}:null;}
  async getSecurityUniverse(exchange:string,limit:number):Promise<SecurityUniverseRecord[]>{
    const info=EXCHANGE_MAP[exchange];if(!info)throw new Error(`Financial Modeling Prep exchange mapping is not configured for ${exchange}`);const bounded=Math.max(1,Math.min(limit,4000));const params={exchange:info.fmp,isEtf:'false',isFund:'false',isActivelyTrading:'true',limit:String(bounded)};const payload=await this.request('/company-screener',params);const observedAt=new Date().toISOString(),endpoint=sourceUrl('/company-screener',params);
    return rows(payload).flatMap((row):SecurityUniverseRecord[]=>{const symbol=text(row.symbol),companyName=text(row.companyName??row.name);if(!symbol||!companyName)return[];const marketCap=finite(row.marketCap),attributes:SecurityUniverseRecord['attributes']={provider_symbol:symbol,universe_ranking:marketCap!=null?'market_capitalization':'unranked'};if(marketCap!=null)attributes.market_capitalization=marketCap;return[{ticker:normalizeTicker(symbol),exchange,companyName,currency:text(row.currency)??info.currency,country:text(row.country)??info.country,sector:text(row.sector),industry:text(row.industry),assetType:'Listed Equity',observedAt,provider:'fmp',sourceUrl:endpoint,attributes}];});
  }
  async getDailyBars(ticker:string,exchange:string,fromDate:string,toDate:string):Promise<DailyBar[]>{
    const symbol=providerSymbol(ticker,exchange),params={symbol,from:fromDate,to:toDate},payload=await this.request('/historical-price-eod/full',params),currency=EXCHANGE_MAP[exchange]?.currency??(await this.getCompanyProfile(symbol).catch(()=>null))?.currency??'USD',provenanceUrl=sourceUrl('/historical-price-eod/full',params);
    return rows(payload).flatMap((row):DailyBar[]=>{const date=text(row.date),close=finite(row.close),volume=finite(row.volume);if(!date||close===null)return[];return[{date,close,volume:volume??undefined,currency,provenance:{provider:this.name,sourceName:'Financial Modeling Prep',sourceUrl:provenanceUrl,query:symbol,status:'OK' as const,rawPayload:row}}];}).sort((a,b)=>a.date.localeCompare(b.date));
  }
  async getLatestPrice(ticker:string,exchange:string):Promise<DailyBar|null>{const symbol=providerSymbol(ticker,exchange),row=firstRow(await this.request('/quote',{symbol})),close=finite(row.price??row.previousClose);if(close===null)return null;const profile=await this.getCompanyProfile(symbol).catch(()=>null);return{date:new Date().toISOString().slice(0,10),close,volume:finite(row.volume)??undefined,currency:profile?.currency??EXCHANGE_MAP[exchange]?.currency??'USD',provenance:{provider:this.name,sourceName:'Financial Modeling Prep',sourceUrl:sourceUrl('/quote',{symbol}),query:symbol,status:'OK' as const,rawPayload:row}};}
  async getAnnualFinancialHistory(ticker:string,exchange:string,limit=5):Promise<FmpFinancialPeriod[]>{
    const symbol=providerSymbol(ticker,exchange),params={symbol,period:'annual',limit:String(Math.max(2,Math.min(limit,10)))};const[incomeRaw,balanceRaw,cashRaw]=await Promise.all([this.request('/income-statement',params),this.request('/balance-sheet-statement',params),this.request('/cash-flow-statement',params)]);const incomeByDate=new Map(rows(incomeRaw).map(row=>[String(row.date??''),row])),balanceByDate=new Map(rows(balanceRaw).map(row=>[String(row.date??''),row])),cashByDate=new Map(rows(cashRaw).map(row=>[String(row.date??''),row])),dates=[...new Set([...incomeByDate.keys(),...balanceByDate.keys(),...cashByDate.keys()].filter(Boolean))].sort().reverse();
    const metricMap:Array<[string,string[]]>=[['revenue',['revenue']],['gross_profit',['grossProfit']],['operating_income',['operatingIncome']],['net_income',['netIncome']],['interest_expense',['interestExpense']],['income_tax_expense',['incomeTaxExpense']],['pre_tax_income',['incomeBeforeTax']],['ebitda',['ebitda']],['cost_of_revenue',['costOfRevenue']],['total_assets',['totalAssets']],['total_liabilities',['totalLiabilities']],['total_equity',['totalStockholdersEquity','totalEquity']],['total_debt',['totalDebt']],['cash_and_equivalents',['cashAndCashEquivalents']],['current_assets',['totalCurrentAssets']],['current_liabilities',['totalCurrentLiabilities']],['current_debt',['shortTermDebt']],['accounts_receivable',['netReceivables','accountsReceivables']],['inventory',['inventory']],['accounts_payable',['accountPayables']],['goodwill',['goodwill']],['shares_outstanding',['weightedAverageShsOutDil','weightedAverageShsOut']],['operating_cash_flow',['netCashProvidedByOperatingActivities','operatingCashFlow']],['capital_expenditure',['capitalExpenditure']],['free_cash_flow',['freeCashFlow']]];
    return dates.slice(0,Number(params.limit)).map(date=>{const income=incomeByDate.get(date)??{},balance=balanceByDate.get(date)??{},cash=cashByDate.get(date)??{},combined=[income,balance,cash],metrics:Record<string,number>={};for(const[name,keys]of metricMap){let value:number|null=null;for(const row of combined)for(const key of keys)if(value===null)value=finite(row[key]);if(value!==null)metrics[name]=value;}return{date,fiscalYear:text(income.calendarYear??income.fiscalYear),period:text(income.period),currency:text(income.reportedCurrency??balance.reportedCurrency??cash.reportedCurrency)??EXCHANGE_MAP[exchange]?.currency??'USD',metrics,sourceUrl:sourceUrl('/income-statement',params)};});
  }
  async getFundamentals(ticker:string,exchange:string,options?:FundamentalsRequestOptions):Promise<Fundamentals>{void options;const[profile,history]=await Promise.all([this.getCompanyProfile(ticker,exchange),this.getAnnualFinancialHistory(ticker,exchange,2)]),latest=history[0];return{...(latest?.metrics??{}),market_capitalization:profile?.marketCap??null,sector:profile?.sector??null,industry:profile?.industry??null,isin:profile?.isin??null,website:profile?.website??null,financial_period:latest?.date??null,provider:'fmp',provider_docs:DOCS_URL};}
}
