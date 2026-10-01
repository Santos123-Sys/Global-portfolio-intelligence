import { z } from 'zod';
import { ThesisCriteria } from '@portfolio-intelligence/agentic-contract';
import { inferResearchMarket, marketResearchModules, researchProviderPolicy, valueScorecardPolicySchema } from '../research-policy';
import type { Foundation } from './foundation';

export const VALUE_CRITERIA = {
  moat:['brand_pricing_power','switching_costs','network_effects','cost_advantage','entry_barriers'],
  management:['integrity_alignment','capital_allocation','insider_alignment','execution_record','succession_culture'],
  financials:['returns_consistency','solvency','free_cash_flow','margin_resilience','earnings_quality'],
  valuation:['margin_of_safety','historical_peer_multiples','fcf_yield','earnings_yield','shareholder_returns'],
} as const;
export const valueCriteriaSchema=z.array(z.object({
  id:z.enum(Object.values(VALUE_CRITERIA).flat() as unknown as [string,...string[]]),
  score:z.number().int().min(1).max(5).nullable(),applicable:z.boolean(),
  rationale:z.string().min(1).max(2000),confidence:z.number().min(0).max(1),
  citations:z.array(z.string().min(1)).max(10),evidence:z.string().max(2000),
}).strict()).length(20).superRefine((criteria,ctx)=>{
  if(new Set(criteria.map(row=>row.id)).size!==20) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Every criterion must appear exactly once'});
  criteria.forEach((row,index)=>{if(!row.applicable && row.score!==null) ctx.addIssue({code:z.ZodIssueCode.custom,path:[index],message:'Not-applicable criteria must have null scores'});});
});

export function thesisResearchPolicy(thesis:unknown,role:string|null) {
  const parsed=ThesisCriteria.safeParse(thesis);
  if(!parsed.success || !role) return null;
  return parsed.data.portfolios.find(portfolio=>portfolio.role===role)?.policy?.research ?? null;
}

export function buildMarketResearchPacket(data:Foundation) {
  const market=inferResearchMarket(data.company);
  const consumer=/consumer|retail|food|beverage|apparel/i.test(`${data.company.sector} ${data.company.industry}`);
  return {
    market,providers:researchProviderPolicy[market],modules:marketResearchModules.filter(module=>module!=='channel_economics'||consumer),
    requirements:{marketSizing:'Reconcile independent top-down and bottom-up estimates with currency, unit, reference date and provenance. If discrepancy exceeds 20%, report a range and unresolved drivers; no invented TAM.',
      revenueDrivers:'Revenue = volume × price × mix; percentage changes compound, not simply add. Use sector-appropriate drivers.',
      competition:'Evidence-backed share and CR3/CR5 on identical market definitions and dates. Do not infer share from company market capitalization.',
      channelEconomics:consumer?'Assess distribution migration, customer acquisition and contribution economics where supported.':'Consumer/channel modules are not applicable by default.',
      sourcing:'Read existing NewsAdapter documents and existing research evidence; do not create a scraper or bypass configured source adapters.'},
    documents:data.documents,existingBrief:data.marketBrief ?? null,availableEvidence:[...data.sources,...(data.marketBrief?.evidenceRegister.map(row=>row.url) ?? [])],limitations:[...data.dataGaps,...(data.marketBrief?.informationGaps ?? [])],
  };
}

/** Deterministic aggregation only; a score is never a buy/sell action. */
export function calculateValueScorecard(raw:unknown) {
  const input=z.object({policy:valueScorecardPolicySchema,criteria:valueCriteriaSchema,sourceEvidence:z.record(z.string()),dataQuality:z.enum(['verified','review_required','insufficient'])}).strict().parse(raw);
  if(!input.policy.enabled) return {status:'disabled',total:null,coverage:0,requiresHumanReview:true};
  const supported=input.criteria.filter(row=>row.applicable && row.score!=null && row.confidence>=.6 && row.citations.some(source=>input.sourceEvidence[source]?.includes(row.evidence)) && row.evidence.trim().length>0);
  const applicable=input.criteria.filter(row=>row.applicable);
  const coverage=applicable.length ? supported.length/applicable.length : 0;
  const dimensions=Object.entries(VALUE_CRITERIA).map(([dimension,ids])=>{
    const scored=supported.filter(row=>(ids as readonly string[]).includes(row.id));
    return {dimension,score:scored.length ? scored.reduce((sum,row)=>sum+((row.score!-1)/4)*100,0)/scored.length : null,covered:scored.length,applicable:applicable.filter(row=>(ids as readonly string[]).includes(row.id)).length,weight:input.policy.weights[dimension as keyof typeof input.policy.weights]};
  });
  const usable=coverage>=input.policy.minimumEvidenceCoverage && input.dataQuality==='verified' && dimensions.every(row=>row.weight===0 || row.score!=null);
  return {status:usable?'review_required':'insufficient_data',total:usable?dimensions.reduce((sum,row)=>sum+(row.score ?? 0)*row.weight,0):null,dimensions,coverage,criteria:input.criteria,
    requiresHumanReview:true,limitations:['Qualitative score and heuristic aggregation; not a calibrated probability of investment success.','Not-applicable criteria are excluded; missing evidence is not scored as poor performance.','Sector-relative assessment is required; fixed gross-margin, dividend and PE thresholds are not applied.'],
  };
}
