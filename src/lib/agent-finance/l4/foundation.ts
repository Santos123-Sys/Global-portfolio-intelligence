import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { priceHistory, securities,thesisVersions,positions } from '@/lib/db/schema';
import { intelligenceDocuments, marketDataObservations, valuationScenarios, discoveryCandidates } from '@/lib/db/workflow-schema';
import { selectFilingSnapshot } from '@/lib/financial-filing-snapshot';
import { FCFF_INPUTS } from '@/lib/quant/fcff';
import { OPENING_FIELDS, capitalSchema, calculateWacc } from './financial-model';
import type { AnalyzeRequest } from '../contracts';
import { researchComparablePeer } from '@/lib/comparable-research';
import type { ComparableResult } from '@/lib/quant/comparables';
import { technicalIndicators } from './technical';
import {fetchCapitalInputs} from './capital-source';
import { thesisResearchPolicy } from './research-modules';
import { portfolios } from '@/lib/db/schema';
import { MarketBrief } from '@portfolio-intelligence/agentic-contract';
import { resolveResearchProfile } from '../research-policy';

/** L4: retained provider/filing evidence only; no untracked scraper or source bypass. */
export async function loadFoundation(ownerId:string,securityId:string,request?:AnalyzeRequest){
  const[companyRows,observations,prices,documents]=await Promise.all([
    db.select().from(securities).where(eq(securities.id,securityId)).limit(1),
    db.select().from(marketDataObservations).where(and(eq(marketDataObservations.securityId,securityId),eq(marketDataObservations.status,'OK'))).orderBy(desc(marketDataObservations.retrievedAt)).limit(1000),
    db.select().from(priceHistory).where(eq(priceHistory.securityId,securityId)).orderBy(desc(priceHistory.priceDate)).limit(500),
    db.select().from(intelligenceDocuments).where(and(eq(intelligenceDocuments.ownerId,ownerId),eq(intelligenceDocuments.securityId,securityId))).orderBy(desc(intelligenceDocuments.publishedDate)).limit(25),
  ]);
  const company=companyRows[0];if(!company)throw new Error('Security no longer exists');
  const[thesis]=request?.thesisVersionId?await db.select().from(thesisVersions).where(and(eq(thesisVersions.id,request.thesisVersionId),eq(thesisVersions.ownerId,ownerId))).limit(1):[];
  const[portfolio]=request?.portfolioId?await db.select({role:portfolios.portfolioType}).from(portfolios).where(and(eq(portfolios.id,request.portfolioId),eq(portfolios.ownerId,ownerId))).limit(1):[];
  const policy:{researchPolicy?:ReturnType<typeof thesisResearchPolicy>}={researchPolicy:thesisResearchPolicy(thesis?.criteriaJson,portfolio?.role??null)};
  const profile=resolveResearchProfile(company,request?.researchProfile,policy.researchPolicy?.locale),locale:{researchLocale?:'pt-BR'|'en'|'de'|'es'}={researchLocale:profile.locale};
  const[briefRecord]=await db.select({brief:discoveryCandidates.marketBriefJson}).from(discoveryCandidates).where(and(eq(discoveryCandidates.ownerId,ownerId),eq(discoveryCandidates.securityId,securityId),eq(discoveryCandidates.marketBriefStatus,'completed'),request?.portfolioId?eq(discoveryCandidates.portfolioId,request.portfolioId):undefined)).orderBy(desc(discoveryCandidates.updatedAt)).limit(1);
  const brief=MarketBrief.safeParse(briefRecord?.brief),marketContext:{marketBrief?:MarketBrief|null}={marketBrief:brief.success?brief.data:null};
  const holdings=request?.portfolioId?await db.select({ticker:securities.ticker,weight:positions.weight}).from(positions).innerJoin(securities,eq(securities.id,positions.securityId)).where(eq(positions.portfolioId,request.portfolioId)):[];
  const metrics=[...new Set([...FCFF_INPUTS,...OPENING_FIELDS,'net_income','shares_outstanding','ebitda','gross_profit','cost_of_revenue','accounts_receivable','inventory','accounts_payable','total_liabilities','goodwill','current_assets','current_liabilities','current_debt'])];
  const selected=selectFilingSnapshot(observations,company.currency,metrics),facts=Object.fromEntries([...selected].map(([key,row])=>[key,Number(row.valueNumeric)]));
  if(['current_assets','current_liabilities','current_debt','cash_and_equivalents'].every(key=>Number.isFinite(facts[key])))facts.non_cash_working_capital=facts.current_assets-facts.cash_and_equivalents-facts.current_liabilities+facts.current_debt;
  const sources=[...new Set([...selected.values()].map(row=>row.sourceUrl!))];
  // Historical analysis is provider-neutral: a retained, attributable numeric
  // statement observation can form a period whether it came from issuer IR,
  // SEC/CVM, BrAPI/Maritaca, or licensed FMP data. Source quality is still
  // reviewed separately; admission here does not elevate a vendor to primary.
  const financialDates=observations.filter(row=>row.observationDate&&row.sourceUrl&&row.valueNumeric?.trim()&&metrics.includes(row.metricName)).map(row=>row.observationDate).filter((value):value is string=>!!value);
  const history=[...new Set(financialDates)].sort().map(date=>{const snapshot=selectFilingSnapshot(observations.filter(row=>row.observationDate===date),company.currency,metrics);return{date,facts:Object.fromEntries([...snapshot].map(([key,row])=>[key,Number(row.valueNumeric)])),sources:[...new Set([...snapshot.values()].map(row=>row.sourceUrl!))]};}).filter(row=>row.sources.length);
  const capitalMetrics=['risk_free_rate','beta','equity_risk_premium','country_risk_premium','cost_of_debt','terminal_growth_rate'];
  const marketInputs=Object.fromEntries(capitalMetrics.map(metric=>[metric,observations.find(row=>row.metricName===metric&&row.sourceUrl&&row.valueNumeric?.trim()&&row.currency===company.currency&&row.observationDate&&Date.parse(row.observationDate)<=Date.now()&&Date.parse(row.observationDate)>=Date.now()-180*86400000)]));
  const number=(key:string)=>marketInputs[key]?Number(marketInputs[key]!.valueNumeric):undefined;
  const marketCapitalization=observations.find(row=>row.metricName==='market_capitalization'&&row.currency===company.currency&&row.sourceUrl&&row.observationDate&&Date.parse(row.observationDate)>=Date.now()-30*86400000);
  const marketEquity=marketCapitalization?Number(marketCapitalization.valueNumeric):prices[0]&&facts.shares_outstanding?Number(prices[0].close)*facts.shares_outstanding:NaN;
  const tax=facts.pre_tax_income>0?facts.income_tax_expense/facts.pre_tax_income:undefined,debtWeight=marketEquity>0&&facts.total_debt>=0?facts.total_debt/(marketEquity+facts.total_debt):undefined;
  let feedCapital=null;try{feedCapital=await fetchCapitalInputs(company.ticker,company.currency);}catch{/* absent source remains absent */}
  const capital=request?.userOverrides?.capitalInputs??feedCapital??{riskFreeRate:number('risk_free_rate'),beta:number('beta'),equityRiskPremium:number('equity_risk_premium'),countryRiskPremium:number('country_risk_premium'),costOfDebt:number('cost_of_debt'),taxRate:request?.userOverrides?.assumptions?.taxRate??tax,debtWeight,sources:[...sources,...Object.values(marketInputs).flatMap(row=>row?.sourceUrl?[row.sourceUrl]:[])],currency:company.currency,asOf:new Date().toISOString().slice(0,10)};
  const parsedCapital=capitalSchema.safeParse(capital),wacc=parsedCapital.success&&parsedCapital.data.currency===company.currency&&Date.parse(parsedCapital.data.asOf)<=Date.now()&&Date.parse(parsedCapital.data.asOf)>=Date.now()-180*86400000?calculateWacc(parsedCapital.data):null;
  const[peerRecord]=await db.select({result:valuationScenarios.resultJson,sources:valuationScenarios.sourceReferences,createdAt:valuationScenarios.createdAt}).from(valuationScenarios).innerJoin(discoveryCandidates,eq(discoveryCandidates.id,valuationScenarios.candidateId)).where(and(eq(valuationScenarios.ownerId,ownerId),eq(discoveryCandidates.securityId,securityId),eq(valuationScenarios.method,'comparable_companies'))).orderBy(desc(valuationScenarios.createdAt)).limit(1);
  const peerResult=peerRecord?.result as ComparableResult|undefined,peers=peerResult?.currency===company.currency&&Array.isArray(peerResult.peers)&&peerRecord.createdAt.getTime()>=Date.now()-180*86400000?peerResult.peers.filter(row=>row.sourceUrl&&row.evEbitda!=null&&row.evEbitda>0):[];
  const estimateMetrics=observations.filter(row=>/^(ntm_|consensus_|estimate_)/.test(row.metricName)&&row.currency===company.currency&&row.sourceUrl&&row.observationDate&&Date.parse(row.observationDate)>=Date.now()-180*86400000&&Date.parse(row.observationDate)<=Date.now());
  let estimates=estimateMetrics.map(row=>({metric:row.metricName,value:Number(row.valueNumeric),source:row.sourceUrl!,kind:'provider_estimate',asOf:row.observationDate!})).filter(row=>Number.isFinite(row.value));const dataGaps:string[]=[];
  if(!estimates.length)try{const forward=await researchComparablePeer(company);if(forward.forecastSourceUrl)estimates=[['ntm_revenue',forward.ntmRevenue],['ntm_ebitda',forward.ntmEbitda],['ntm_net_income',forward.ntmNetIncome]].flatMap(([metric,value])=>typeof value==='number'&&Number.isFinite(value)?[{metric:String(metric),value,source:forward.forecastSourceUrl!,kind:'labelled_public_forecast_requires_review',asOf:new Date().toISOString().slice(0,10)}]:[]);dataGaps.push(...forward.gaps);}catch{dataGaps.push('Existing comparable research adapter could not retrieve labelled forward estimates.');}
  return{...policy,...locale,...marketContext,company,facts,sources,fiscalDate:[...selected.values()][0]?.observationDate??null,history,wacc,terminalGrowth:number('terminal_growth_rate'),peers,estimates,dataGaps,thesisContext:thesis?.criteriaJson??null,holdings,observations:observations.map(row=>({metric:row.metricName,value:row.valueNumeric??row.valueText,currency:row.currency,date:row.observationDate,source:row.sourceUrl,provider:row.provider})),prices:prices.reverse().map(row=>({date:row.priceDate,close:Number(row.close),currency:row.currency,source:row.source,volume:row.volume!=null?Number(row.volume):null})),documents:documents.map(row=>({id:row.id,title:row.title,type:row.folderType,source:row.url??`document:${row.id}`,publishedAt:row.publishedDate?.toISOString()??null,excerpt:row.contentText?.slice(0,4000)??''}))};
}
export type Foundation=Awaited<ReturnType<typeof loadFoundation>>&{financialReview?:{reviewedAt:string;periods:Array<{date:string;days:number;sourceQuality:'primary'|'official_api'|'licensed_data'|'secondary'|'unknown'}>}};
export function sourceEvidence(data:Foundation):Record<string,string>{const evidence:Record<string,string>={};const add=(source:string,text:string)=>{evidence[source]=(evidence[source]??'')+'\n'+text;};data.sources.forEach(source=>{const rows=data.observations.filter(row=>row.source===source&&row.currency===data.company.currency&&row.date===data.fiscalDate&&row.metric in data.facts&&Number(row.value)===data.facts[row.metric]);if(rows.length)add(source,JSON.stringify({currency:data.company.currency,fiscalDate:data.fiscalDate,observations:rows}));});data.history.forEach(period=>period.sources.forEach(source=>{const rows=data.observations.filter(row=>row.source===source&&row.currency===data.company.currency&&row.date===period.date&&row.metric in period.facts&&Number(row.value)===period.facts[row.metric]);if(rows.length)add(source,JSON.stringify({currency:data.company.currency,date:period.date,observations:rows}));}));data.documents.forEach(row=>add(row.source,row.excerpt));data.marketBrief?.evidenceRegister.forEach(row=>add(row.url,row.excerpt));data.peers.forEach(row=>add(row.sourceUrl,JSON.stringify(row)));data.estimates.forEach(row=>add(row.source,JSON.stringify(row)));data.wacc?.sources.forEach(source=>add(source,JSON.stringify(data.wacc)));if(data.prices.length)add(`market-data:${data.company.id}`,JSON.stringify({prices:data.prices,indicators:technicalIndicators(data.prices)}));return evidence;}
