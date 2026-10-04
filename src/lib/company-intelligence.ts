import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { aiAnalyses, alerts, portfolios, positions, priceHistory, riskMetrics, securities, transactions } from '@/lib/db/schema';
import { companyWorkspaces, discoveryCandidates, intelligenceDocuments, marketDataObservations } from '@/lib/db/workflow-schema';
import { agentAnalysisSessions } from '@/lib/db/agent-schema';

const num=(value:string|number|null|undefined)=>value==null||!Number.isFinite(Number(value))?null:Number(value);
export async function dashboardData(ticker:string,ownerId:string,viewer:boolean){
  const allowed=await db.select({id:securities.id}).from(securities).where(eq(securities.ticker,ticker.trim().toUpperCase())).limit(1);
  const company=allowed[0]?await db.select().from(securities).where(eq(securities.id,allowed[0].id)).limit(1):[];
  const security=company[0];if(!security)return null;
  const [held,analysed,workspace,candidate,researchSession]=await Promise.all([
    db.select({id:positions.id}).from(positions).innerJoin(portfolios,eq(portfolios.id,positions.portfolioId)).where(and(eq(positions.securityId,security.id),eq(portfolios.ownerId,ownerId))).limit(1),
    db.select({id:aiAnalyses.id}).from(aiAnalyses).where(and(eq(aiAnalyses.securityId,security.id),eq(aiAnalyses.ownerId,ownerId))).limit(1),
    db.select().from(companyWorkspaces).where(and(eq(companyWorkspaces.securityId,security.id),eq(companyWorkspaces.ownerId,ownerId))).limit(1),
    db.select({id:discoveryCandidates.id}).from(discoveryCandidates).where(and(eq(discoveryCandidates.securityId,security.id),eq(discoveryCandidates.ownerId,ownerId))).limit(1),
    db.select({id:agentAnalysisSessions.id}).from(agentAnalysisSessions).where(and(eq(agentAnalysisSessions.securityId,security.id),eq(agentAnalysisSessions.ownerId,ownerId))).limit(1),
  ]);
  if(!held[0]&&!analysed[0]&&!workspace[0]&&!candidate[0]&&!researchSession[0])return null;
  const [prices,posRows,analyses,fundamentals,alertRows,docs]=await Promise.all([
    db.select().from(priceHistory).where(eq(priceHistory.securityId,security.id)).orderBy(desc(priceHistory.priceDate)).limit(2000),
    db.select({portfolioId:portfolios.id,portfolioName:portfolios.name,quantity:positions.quantity,avgCost:positions.avgCost,marketValueNative:positions.marketValueNative,weight:positions.weight}).from(positions).innerJoin(portfolios,eq(portfolios.id,positions.portfolioId)).where(and(eq(positions.securityId,security.id),eq(portfolios.ownerId,ownerId))).limit(1),
    db.select().from(aiAnalyses).where(and(eq(aiAnalyses.securityId,security.id),eq(aiAnalyses.ownerId,ownerId))).orderBy(desc(aiAnalyses.analysisTimestamp)).limit(30),
    db.select().from(marketDataObservations).where(and(eq(marketDataObservations.securityId,security.id),eq(marketDataObservations.status,'OK'))).orderBy(desc(marketDataObservations.retrievedAt)),
    db.select().from(alerts).where(and(eq(alerts.securityId,security.id),eq(alerts.ownerId,ownerId))).orderBy(desc(alerts.createdAt)).limit(20),
    db.select().from(intelligenceDocuments).where(and(eq(intelligenceDocuments.securityId,security.id),eq(intelligenceDocuments.ownerId,ownerId))).orderBy(desc(intelligenceDocuments.publishedDate)).limit(50),
  ]);
  const latest=prices[0];const previous=prices[1];const price=num(latest?.close);const previousPrice=num(previous?.close);
  const p=viewer?null:posRows[0];const quantity=num(p?.quantity)??0;const avgCost=num(p?.avgCost)??0;const value=num(p?.marketValueNative)??(price==null?0:price*quantity);const cost=quantity*avgCost;
  const analysis=analyses[0];const metric=new Map<string,string|number>();
  for(const row of fundamentals)if(!metric.has(row.metricName))metric.set(row.metricName,num(row.valueNumeric)??row.valueText??'—');
  return {company:security,viewerMode:viewer,latestPrice:price==null?null:{close:price,priceDate:latest.priceDate,currency:latest.currency,changePct:previousPrice?(price-previousPrice)/previousPrice*100:null},priceHistory:prices.reverse().map(row=>({priceDate:row.priceDate,close:Number(row.close),currency:row.currency})),position:p?{...p,quantity,avgCost,marketValueNative:value,unrealizedPnL:value-cost,unrealizedPnLPct:cost?(value-cost)/cost*100:null}:null,analysis:analysis?{...analysis,analysisTimestamp:analysis.analysisTimestamp.toISOString(),dataTimestamp:analysis.dataTimestamp?.toISOString()??null}:null,analyses:analyses.map(row=>({...row,analysisTimestamp:row.analysisTimestamp.toISOString(),dataTimestamp:row.dataTimestamp?.toISOString()??null})),fundamentals:Object.fromEntries(metric),alerts:alertRows.map(row=>({...row,createdAt:row.createdAt.toISOString()})),documents:{workspace:workspace[0]?{id:workspace[0].id,ragEnabled:workspace[0].ragEnabled}:null,records:docs.map(row=>({...row,publishedDate:row.publishedDate?.toISOString()??null,retrievedAt:row.retrievedAt.toISOString()}))},securityId:security.id};
}
export async function sectionData(ticker:string,ownerId:string,viewer:boolean,section:string){const base=await dashboardData(ticker,ownerId,viewer);if(!base)return null;if(section==='financials')return{periods:[...new Set(base.priceHistory.map(row=>row.priceDate.slice(0,4)))],observations:base.fundamentals};if(section==='risk'){const ids=base.position?[base.position.portfolioId]:[];const rows=ids.length?await db.select().from(riskMetrics).where(inArray(riskMetrics.portfolioId,ids)).orderBy(desc(riskMetrics.computedAt)):[];return{metrics:rows.map(row=>({...row,computedAt:row.computedAt.toISOString(),dataAsOf:row.dataAsOf?.toISOString()??null})),alerts:base.alerts,riskScore:base.analysis?.riskScore??null,thesisBreakers:base.analysis?.thesisBreakers??[]};}if(section==='portfolio'){if(viewer||!base.position)return{viewerMode:true,transactions:[]};const rows=await db.select().from(transactions).where(and(eq(transactions.securityId,base.securityId),eq(transactions.portfolioId,base.position.portfolioId))).orderBy(desc(transactions.txnDate));return{viewerMode:false,position:base.position,transactions:rows.map(row=>({...row,quantity:num(row.quantity),price:num(row.price),fees:num(row.fees)}))};}return base;}
