import { z } from 'zod';
import { outputSchema, type AgentOutput, type AnalyzeRequest } from './contracts';
import { inferResearchMarket, researchProviderPolicy } from './research-policy';

const dynamicResearchSection=z.object({agent:z.string(),taskId:z.string().nullable(),label:z.string().nullable(),output:outputSchema});
/** One aggregation contract for existing dashboard/report consumers; no new report engine. */
export const equityResearchSchema=z.object({
  version:z.literal('equity-research-v1'),
  metadata:z.object({ticker:z.string(),market:z.enum(['BR','US','CH','EU','OTHER']),locale:z.enum(['pt-BR','en','de','es']),currency:z.string(),asOf:z.string().nullable(),sector:z.string().nullable()}),
  authority:z.literal('research_only'),requiresHumanReview:z.literal(true),
  sections:z.object({earningsQuality:outputSchema.nullable(),industryResearch:outputSchema.nullable(),dynamicResearch:z.array(dynamicResearchSection),fundamentals:outputSchema.nullable(),valuation:outputSchema.nullable(),bullCase:outputSchema.nullable(),bearCase:outputSchema.nullable(),review:outputSchema.nullable()}),
  sources:z.array(z.string()),limitations:z.array(z.string()),
});
export function aggregateEquityResearch(company:{ticker:string;currency:string;country?:string|null;exchange?:string|null;sector:string|null},date:string|null,request:AnalyzeRequest,outputs:Record<string,AgentOutput>,locale?:'pt-BR'|'en'|'de'|'es') {
  const market=inferResearchMarket(company);
  const dynamicResearch=Object.entries(outputs).filter(([name])=>name.startsWith('dynamic-research-')).map(([agent,output])=>({
    agent,
    taskId:typeof output.data.taskId==='string' ? output.data.taskId : null,
    label:typeof output.data.label==='string' ? output.data.label : null,
    output,
  }));
  return equityResearchSchema.parse({version:'equity-research-v1',metadata:{ticker:company.ticker,market,locale:request.researchProfile?.locale ?? locale ?? (market==='BR'?'pt-BR':'en'),currency:company.currency,asOf:date,sector:company.sector},
    authority:'research_only',requiresHumanReview:true,
    sections:{earningsQuality:outputs['financial-statement-analyzer'] ?? null,industryResearch:outputs['market-industry-research'] ?? null,dynamicResearch,fundamentals:outputs['fundamental-analyst'] ?? null,valuation:outputs['sanity-checker'] ?? null,bullCase:outputs['bull-agent'] ?? null,bearCase:outputs['bear-agent'] ?? null,review:outputs['judge-agent'] ?? null},
    sources:[...new Set(Object.values(outputs).flatMap(output=>output.citations))],limitations:[...new Set(Object.values(outputs).flatMap(output=>output.limitations))],
  });
}
export function researchPlan(company:{country?:string|null;exchange?:string|null},analysisType:AnalyzeRequest['analysisType']) {
  const market=inferResearchMarket(company);
  return {market,providers:researchProviderPolicy[market],analysisType,can:['Read existing evidence','Calculate financial metrics and valuation scenarios','Dynamically decompose bounded evidence questions','Propose research conclusions'],cannot:['Approve a candidate','Replace accepted analysis','Change weights','Execute trades'],approval:'Human review is mandatory before acceptance; timeouts never approve.',control:'Pause and cancel fence the worker; already-sent external requests cannot be revoked.'};
}
