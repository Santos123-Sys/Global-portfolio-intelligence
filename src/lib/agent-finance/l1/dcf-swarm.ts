import { deriveFcff } from '@/lib/quant/fcff';
import type { DcfAssumptions } from '@/lib/quant/dcf';
import { evidenceOutput, type AnalyzeRequest, type AgentOutput } from '../contracts';
import type { Foundation } from '../l4/foundation';
import { driverSchema, OPENING_FIELDS, projectStatements, valueProjection, sensitivityAnalysis, type Drivers, type StatementModel } from '../l4/financial-model';

export interface DcfContext { request: AnalyzeRequest; foundation: Foundation; outputs: Record<string, AgentOutput> }
export function buildAssumptions(context: DcfContext): { input: DcfAssumptions | null; missing: string[]; drivers?: Drivers; model?: StatementModel } {
  const { request, foundation:f } = context, o=request.userOverrides, a=o?.assumptions, facts=f.facts;
  if(/bank|insurance|financial services|reit/i.test(f.company.sector ?? '')) return {input:null,missing:['FCFF method suitability: review an equity-based valuation for financial institutions/REITs']};
  const taxRate=a?.taxRate ?? f.wacc?.taxRate ?? (facts.pre_tax_income>0 ? facts.income_tax_expense/facts.pre_tax_income : undefined);
  const derivation=deriveFcff(facts,{method:'ebit',taxRate});
  const prior=f.history?.filter(row=>row.date!==f.fiscalDate && Number.isFinite(row.facts.revenue)).at(-1);
  const years=prior && f.fiscalDate ? (Date.parse(f.fiscalDate)-Date.parse(prior.date))/(365.25*86400_000) : 0;
  const consensus=f.estimates?.find(row=>row.metric==='ntm_revenue' && row.kind==='provider_estimate');
  const growth=o?.drivers?.growth ?? a?.annualGrowthRate ?? (consensus && facts.revenue>0 ? consensus.value/facts.revenue-1 : prior && years>=.9 && prior.facts.revenue>0 ? (facts.revenue/prior.facts.revenue)**(1/years)-1 : undefined);
  const discountRate=o?.discountRate ?? f.wacc?.wacc, terminalGrowthRate=a?.terminalGrowthRate ?? f.terminalGrowth;
  const netDebt=a?.netDebt ?? (Number.isFinite(facts.total_debt) && Number.isFinite(facts.cash_and_equivalents) ? facts.total_debt-facts.cash_and_equivalents : undefined);
  const shares=a?.sharesOutstanding ?? facts.shares_outstanding;
  const drivers=driverSchema.safeParse(o?.drivers ?? { growth,operatingMargin:facts.operating_income/facts.revenue,depreciationRatio:facts.depreciation_and_amortization/facts.revenue,
    capexRatio:Math.abs(facts.capital_expenditure)/facts.revenue,workingCapitalRatio:facts.non_cash_working_capital/facts.revenue,taxRate,
    debtRate:f.wacc?.costOfDebt ?? (facts.total_debt>0 ? facts.interest_expense/facts.total_debt : facts.total_debt===0 ? 0 : undefined),payoutRatio:0,minimumCash:0 });
  const missing=[...derivation.missingFields,...OPENING_FIELDS.filter(key=>!Number.isFinite(facts[key]))];
  if (growth==null) missing.push('reviewed_annual_growth_rate_or_historical_revenue');
  if (discountRate==null) missing.push('reviewed_wacc');
  if (terminalGrowthRate==null) missing.push('source_backed_terminal_growth_or_override');
  if (!drivers.success) missing.push(...drivers.error.issues.map(issue=>`driver:${issue.path.join('.')}`));
  if (!Number.isFinite(netDebt)) missing.push('net_debt');
  if (!shares || !Number.isFinite(shares) || shares<=0) missing.push('positive_shares_outstanding');
  if (!f.fiscalDate || !f.sources.length) missing.push('coherent_primary_filing');
  if (missing.length) return {input:null,missing:[...new Set(missing)]};
  try {
    const model=projectStatements(facts,drivers.data!,o?.timeHorizon ?? 5);
    valueProjection(model,discountRate!,terminalGrowthRate!,netDebt!,shares);
    return {input:{currency:f.company.currency,startingFreeCashFlow:derivation.value!,forecastYears:o?.timeHorizon ?? 5,annualGrowthRate:growth!,discountRate:discountRate!,terminalGrowthRate:terminalGrowthRate!,netDebt:netDebt!,sharesOutstanding:shares,dataAsOf:`${f.fiscalDate}T00:00:00Z`,sourceReferences:[...new Set([...f.sources,...(f.wacc?.sources ?? [])])]},drivers:drivers.data,model,missing:[]};
  } catch(e) { return {input:null,missing:[e instanceof Error ? e.message : 'Invalid model']}; }
}

export async function dcfAgent(name:string,context:DcfContext,_compute:(input:DcfAssumptions)=>Promise<unknown>):Promise<AgentOutput> {
  void _compute; // Compatibility with the existing registry-facing call signature.
  const f=context.foundation;
  if(name==='dcf-orchestrator') return evidenceOutput({workflow:['assumptions','growth','projection','wacc','terminal','sensitivity','sanity']},['Validate coherent financial evidence before computing projections.'],f.sources);
  const built=buildAssumptions(context);
  if(!built.input || !built.model || !built.drivers) return {...evidenceOutput({missingInputs:built.missing},['Required financial evidence is absent; never synthesize missing facts.'],f.sources,built.missing,0),status:'blocked'};
  const input=built.input,model=built.model,drivers=built.drivers;
  const audit=['Revenue, margins, reinvestment, working capital and financing policies generate linked IS/BS/CF forecasts.',model.accountingPolicy];
  if(name==='assumption-setter') return evidenceOutput({assumptions:input,drivers,origin:context.request.userOverrides?.drivers ? 'reviewed_policy' : 'historical_ratios_and_dated_estimates',forecastPolicy:'Retain earnings, no dividends unless overridden; fund cash shortfalls with debt. Modeling policy, not observed management plans.'},audit,input.sourceReferences,[],70);
  if(name==='growth-modeler') return evidenceOutput({revenueForecast:model.projections.map(row=>({year:row.year,revenue:row.incomeStatement.revenue,ebitda:row.incomeStatement.ebitda})),estimates:f.estimates ?? [],historical:f.history ?? []},['Prioritize reviewed growth, then dated provider NTM revenue, then historical revenue CAGR.'],input.sourceReferences,[],70);
  if(name==='projection-builder') return evidenceOutput({...model,fcffDerivation:deriveFcff(f.facts,{method:'ebit',taxRate:drivers.taxRate})},audit,input.sourceReferences,[],75);
  if(name==='wacc-calculator') return evidenceOutput({...(f.wacc ?? {}),wacc:input.discountRate,origin:context.request.userOverrides?.discountRate ? 'reviewed_override' : 'dated_currency_matched_CAPM'},['Equity cost = risk-free + beta × equity premium + country premium; blend with after-tax debt cost at market weights.'],input.sourceReferences,[],75);
  const result=valueProjection(model,input.discountRate,input.terminalGrowthRate,input.netDebt,input.sharesOutstanding);
  const multiples=(f.peers ?? []).map(row=>row.evEbitda).filter((v):v is number=>v!=null && Number.isFinite(v) && v>0).sort((a,b)=>a-b);
  const multiple=multiples.length>=6 ? (multiples[Math.floor((multiples.length-1)/2)]+multiples[Math.ceil((multiples.length-1)/2)])/2 : null;
  const sources=[...new Set([...input.sourceReferences,...(f.peers ?? []).map(row=>row.sourceUrl)])];
  if(name==='terminal-value') return evidenceOutput({...result,currency:input.currency,exitMultiple:multiple,exitValuation:multiple!=null ? valueProjection(model,input.discountRate,input.terminalGrowthRate,input.netDebt,input.sharesOutstanding,multiple) : null},['Discount projected FCFF; subtract net debt and divide by shares.','Exit valuation uses median verified EV/EBITDA of at least six reviewed peers.'],sources,multiple==null ? ['At least six reviewed same-currency peers with positive EBITDA are needed for exit valuation.'] : [],70);
  if(name==='sensitivity-analyst') {
    const requestedPolicy=context.request.userOverrides?.simulation;
    const attempt=Number(context.outputs['qa-feedback']?.data.attempt ?? 0);
    const scale=2**Math.min(2,Math.max(0,attempt));
    const policy=requestedPolicy ? {...requestedPolicy,growthWidth:requestedPolicy.growthWidth/scale,marginWidth:requestedPolicy.marginWidth/scale,waccWidth:requestedPolicy.waccWidth/scale} : undefined;
    const data={...sensitivityAnalysis(f.facts,drivers,input.forecastYears,input.discountRate,input.terminalGrowthRate,input.netDebt,input.sharesOutstanding,policy),requestedPolicy,effectivePolicy:policy,qaNarrowing:scale>1};
    return evidenceOutput(data,['Reprice 49 WACC/terminal-growth cells and rank driver sensitivity.','Simulation uses seeded, independent triangular distributions and explicitly supplied scenario probabilities.'],input.sourceReferences,data.monteCarlo ? [] : ['Review distribution widths and probabilities to enable Monte Carlo and probability weighting.'],70);
  }
  const independentPV=model.projections.reduce((sum,row)=>sum+row.cashFlow.fcff/(1+input.discountRate)**row.year,0)+result.terminalValue/(1+input.discountRate)**input.forecastYears;
  const numericalError=Math.abs(independentPV-result.enterpriseValue);
  if(numericalError>Math.max(1,result.enterpriseValue)*1e-9) throw new Error('Independent DCF math check failed');
  const market=f.prices.at(-1)?.close,deviation=market && market>0 ? Math.abs(result.fairValuePerShare/market-1) : null;
  const flags=[...(deviation!=null && deviation>.5 ? ['Value differs from market by >50%'] : []),...(result.terminalShare>.75 ? ['Terminal value exceeds 75% of enterprise value'] : [])];
  return evidenceOutput({model:result,requiresHumanReview:true,extremeDeviation:deviation!=null && deviation>.5,redFlags:flags,independentMathError:numericalError,statementChecks:model.projections.map(row=>row.checks)},['Reconcile statements and independently discount projected FCFF.','Market divergence and terminal concentration require review; no orders are created.'],sources,[],flags.length ? 60 : 75);
}
