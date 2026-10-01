import { z } from 'zod';
import { outputSchema, type AgentOutput } from '../contracts';
import { sectorPolicy } from '../research-policy';

const periodSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const date = new Date(value); return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value; }, 'Invalid fiscal date'),
  basis: z.enum(['annual', 'quarterly_discrete', 'quarterly_ytd']).default('annual'),
  facts: z.record(z.number().finite()),
  sources: z.array(z.string().min(1)).min(1),
  provider: z.string().min(1).default('existing_data_layer'),
  days: z.number().int().min(1).max(380).optional(),
  fiscalQuarter: z.number().int().min(1).max(4).optional(),
  fiscalYear:z.string().regex(/^\d{4}$/).optional(),
  reviewed:z.boolean().default(false),
  sourceQuality:z.enum(['primary','official_api','licensed_data','secondary','unknown']).default('unknown'),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  unit: z.literal('base_currency').optional(),
});

export const financialStatementInputSchema = z.object({
  ticker: z.string().min(1), currency: z.string().regex(/^[A-Z]{3}$/), unit:z.literal('base_currency').default('base_currency'),sector: z.string().nullable().optional(),
  periods: z.array(periodSchema).min(2).max(24),
});
export type FinancialStatementInput = z.infer<typeof financialStatementInputSchema>;

type Signal = { code: string; severity: 'low'|'medium'|'high'; period: string; observed: number; threshold: number; rationale: string; ruleStatus: 'active'|'sector_suppressed' };
const flowFields = new Set(['revenue','cost_of_revenue','gross_profit','operating_income','net_income','operating_cash_flow','capital_expenditure']);
const number = (facts: Record<string,number>, key: string) => Number.isFinite(facts[key]) ? facts[key] : null;
const divide = (a:number|null,b:number|null) => a != null && b != null && b > 0 && Number.isFinite(a/b) ? a/b : null;
const change = (now:number|null,before:number|null) => now != null && before != null && before !== 0 ? (now-before)/Math.abs(before) : null;
const average = (now:number|null,before:number|null) => now != null && before != null ? (now+before)/2 : now;

function discretePeriods(periods: FinancialStatementInput['periods']) {
  return periods.map((period,index) => {
    if(period.basis !== 'quarterly_ytd') return period;
    const previous=periods[index-1]; const year=period.fiscalYear;
    if(!period.fiscalQuarter) throw new Error('YTD normalization requires fiscalQuarter');
    if(!year) throw new Error('YTD normalization requires fiscalYear, not calendar-year inference');
    if(period.fiscalQuarter===1) return {...period,basis:'quarterly_discrete' as const};
    if(!previous || previous.fiscalYear!==year || previous.basis!=='quarterly_ytd' || previous.fiscalQuarter!==period.fiscalQuarter-1) throw new Error('YTD normalization requires the preceding cumulative fiscal quarter');
    return {...period,basis:'quarterly_discrete' as const,facts:Object.fromEntries(Object.entries(period.facts).flatMap(([key,value])=>flowFields.has(key) ? previous.facts[key]==null ? [] : [[key,value-previous.facts[key]]] : [[key,value]]))};
  });
}

export function analyzeFinancialStatements(raw: FinancialStatementInput): AgentOutput {
  const input=financialStatementInputSchema.parse(raw); const periods=discretePeriods([...input.periods].sort((a,b)=>a.date.localeCompare(b.date)));
  if(new Set(periods.map(period=>period.date)).size!==periods.length) throw new Error('Duplicate fiscal periods must be reconciled before analysis');
  if(new Set(periods.map(period=>period.basis)).size>1) throw new Error('Annual and quarterly observations must be analyzed separately');
  if(periods.some(period=>period.currency && period.currency!==input.currency)) throw new Error('Mixed reporting currencies must be normalized before analysis');
  const policy=sectorPolicy(input.sector); const disabled=new Set(policy.disabledRules); const signals:Signal[]=[];
  const metrics=periods.map((period,index)=>{
    const priorPeriod=periods[index-1];
    const distance=priorPeriod ? (Date.parse(period.date)-Date.parse(priorPeriod.date))/86400_000 : 0;
    const adjacent=period.basis==='annual' ? distance>=330 && distance<=380 : distance>=60 && distance<=110;
    const prior=adjacent ? priorPeriod.facts : {};
    const days=period.days ?? (period.basis==='annual' ? 365 : 91.25); const facts=period.facts;
    const revenue=number(facts,'revenue'),rawCogs=number(facts,'cost_of_revenue'),cogs=rawCogs==null?null:Math.abs(rawCogs),netIncome=number(facts,'net_income'),ocf=number(facts,'operating_cash_flow');
    const ar=number(facts,'accounts_receivable'),inventory=number(facts,'inventory'),ap=number(facts,'accounts_payable');
    const currentAssets=number(facts,'current_assets') ?? number(facts,'total_current_assets');
    const currentLiabilities=number(facts,'current_liabilities') ?? number(facts,'total_current_liabilities');
    const equity=number(facts,'total_equity'),assets=number(facts,'total_assets'),debt=number(facts,'total_debt');
    const capex=number(facts,'capital_expenditure');
    const previousYear=periods.find(candidate=>Math.abs((Date.parse(period.date)-Date.parse(candidate.date))/86400_000-365)<=20 && (period.basis==='annual' || candidate.fiscalQuarter===period.fiscalQuarter));
    return {
      date:period.date,basis:period.basis,adjacent,
      revenueGrowth:change(revenue,number(prior,'revenue')),
      revenueYoY:change(revenue,previousYear ? number(previousYear.facts,'revenue') : null),
      revenueQoQ:period.basis==='quarterly_discrete' ? change(revenue,number(prior,'revenue')) : null,
      receivablesGrowth:change(ar,number(prior,'accounts_receivable')),
      inventoryGrowth:change(inventory,number(prior,'inventory')),
      grossMargin:divide(number(facts,'gross_profit') ?? (revenue!=null && cogs!=null ? revenue-cogs : null),revenue),
      operatingMargin:divide(number(facts,'operating_income'),revenue),netMargin:divide(netIncome,revenue),
      cashConversion:netIncome!=null && netIncome>0 ? divide(ocf,netIncome) : null,
      currentRatio:divide(currentAssets,currentLiabilities),debtToEquity:divide(debt,equity),
      liabilitiesToAssets:divide(number(facts,'total_liabilities'),assets),goodwillToAssets:divide(number(facts,'goodwill'),assets),
      interestCoverage:divide(number(facts,'operating_income'),number(facts,'interest_expense')),
      payablesGrowth:change(ap,number(prior,'accounts_payable')),costGrowth:change(cogs,number(prior,'cost_of_revenue')==null?null:Math.abs(prior.cost_of_revenue)),
      returnOnEquity:divide(netIncome,average(equity,number(prior,'total_equity'))),returnOnAssets:divide(netIncome,average(assets,number(prior,'total_assets'))),
      dso:divide(average(ar,number(prior,'accounts_receivable')),revenue)!=null ? divide(average(ar,number(prior,'accounts_receivable')),revenue)!*days : null,
      dio:divide(average(inventory,number(prior,'inventory')),cogs)!=null ? divide(average(inventory,number(prior,'inventory')),cogs)!*days : null,
      dpo:divide(average(ap,number(prior,'accounts_payable')),cogs)!=null ? divide(average(ap,number(prior,'accounts_payable')),cogs)!*days : null,
      freeCashFlow:ocf!=null && capex!=null ? ocf-Math.abs(capex) : null,
    };
  });
  const add=(rule:string,signal:Omit<Signal,'ruleStatus'>)=>signals.push({...signal,ruleStatus:disabled.has(rule)?'sector_suppressed':'active'});
  metrics.forEach((metric,index)=>{
    const previous=metrics[index-1]; if(!previous || !metric.adjacent) return;
    if(metric.receivablesGrowth!=null && metric.revenueGrowth!=null && metric.receivablesGrowth-metric.revenueGrowth>.2) add('receivables_growth',{code:'AR_GROWTH_DIVERGENCE',severity:metric.receivablesGrowth-metric.revenueGrowth>.4?'high':'medium',period:metric.date,observed:metric.receivablesGrowth-metric.revenueGrowth,threshold:.2,rationale:'Receivables growth exceeded revenue growth; review collection and revenue-recognition evidence.'});
    if(metric.inventoryGrowth!=null && metric.revenueGrowth!=null && metric.inventoryGrowth-metric.revenueGrowth>.15) add('inventory_growth',{code:'INVENTORY_GROWTH_DIVERGENCE',severity:'medium',period:metric.date,observed:metric.inventoryGrowth-metric.revenueGrowth,threshold:.15,rationale:'Inventory growth exceeded revenue growth; review demand, production and impairment evidence.'});
    if(metric.grossMargin!=null && previous.grossMargin!=null && Math.abs(metric.grossMargin-previous.grossMargin)>.05) add('gross_margin_change',{code:'GROSS_MARGIN_CHANGE',severity:'medium',period:metric.date,observed:metric.grossMargin-previous.grossMargin,threshold:.05,rationale:'Gross margin changed materially between comparable periods.'});
    if(metric.netMargin!=null && previous.netMargin!=null && Math.abs(metric.netMargin-previous.netMargin)>.03) add('net_margin_change',{code:'NET_MARGIN_CHANGE',severity:'medium',period:metric.date,observed:metric.netMargin-previous.netMargin,threshold:.03,rationale:'Net margin changed materially; review taxes, one-off items and costs.'});
    if(metric.payablesGrowth!=null && metric.costGrowth!=null && Math.abs(metric.payablesGrowth-metric.costGrowth)>.2) add('payables_growth',{code:'AP_COST_DIVERGENCE',severity:'medium',period:metric.date,observed:metric.payablesGrowth-metric.costGrowth,threshold:.2,rationale:'Payables and cost growth diverged; review supplier terms, acquisition effects and financing.'});
  });
  metrics.forEach(metric=>{
    if(metric.cashConversion!=null && metric.cashConversion<.5) add('cash_conversion',{code:'LOW_CASH_CONVERSION',severity:metric.cashConversion<0?'high':'medium',period:metric.date,observed:metric.cashConversion,threshold:.5,rationale:'Positive accounting earnings converted weakly into operating cash flow.'});
    if(metric.currentRatio!=null && metric.currentRatio<1) add('current_ratio',{code:'LOW_CURRENT_RATIO',severity:metric.currentRatio<.7?'high':'medium',period:metric.date,observed:metric.currentRatio,threshold:1,rationale:'Current assets do not cover current liabilities; sector context and committed facilities require review.'});
    if(metric.goodwillToAssets!=null && metric.goodwillToAssets>.3) add('goodwill_ratio',{code:'HIGH_GOODWILL',severity:'medium',period:metric.date,observed:metric.goodwillToAssets,threshold:.3,rationale:'Goodwill is material relative to assets; review impairment and acquisition performance.'});
    if(metric.liabilitiesToAssets!=null && metric.liabilitiesToAssets>.7) add('total_liabilities_ratio',{code:'HIGH_LIABILITIES_RATIO',severity:'medium',period:metric.date,observed:metric.liabilitiesToAssets,threshold:.7,rationale:'Total liabilities are high relative to assets. This is not interest-bearing debt leverage.'});
  });
  let streak=0;
  periods.forEach((period,index)=>{
    if(index>0 && !metrics[index].adjacent) streak=0;
    const ocf=number(period.facts,'operating_cash_flow');streak=ocf!=null && ocf<0 ? streak+1 : 0;
    if(streak>=2) add('negative_ocf',{code:'PERSISTENT_NEGATIVE_OCF',severity:streak>=3?'high':'medium',period:period.date,observed:streak,threshold:2,rationale:'Operating cash flow was negative across consecutive periods; assess seasonality and funding capacity.'});
  });
  const required=['revenue','net_income','operating_cash_flow','total_assets','total_equity'];
  const available=required.filter(key=>number(periods.at(-1)!.facts,key)!=null); const completeness=available.length/required.length;
  const issues:string[]=[]; if(completeness<1) issues.push(`Missing core fields: ${required.filter(key=>!available.includes(key)).join(', ')}`);
  if(periods.some(period=>!period.days)) issues.push('Period day counts unavailable; day-based ratios use 365 or 91.25 days and require review.');
  if(metrics.slice(1).some(metric=>!metric.adjacent)) issues.push('Non-consecutive fiscal periods: adjacent-period trends withheld.');
  if(periods.some(period=>required.some(key=>number(period.facts,key)==null))) issues.push('Some historical periods lack core statement fields; complete-series comparisons require review.');
  if(periods.some(period=>!period.reviewed || !['primary','official_api'].includes(period.sourceQuality))) issues.push('Source provenance and period inputs require explicit review before automatic score aggregation.');
  const limitations=[...issues,'Anomaly thresholds are screening heuristics, not evidence of accounting misconduct.','Opening-balance ratios in the first period use ending balances when no preceding snapshot exists.',...policy.notes];
  const citations=[...new Set(periods.flatMap(period=>period.sources))];
  const activeSignals=signals.filter(signal=>signal.ruleStatus==='active');
  const status=completeness<1?'insufficient_data':'completed';
  const evidence=`${periods.length} periods; ${activeSignals.length} active anomaly signals; ${(completeness*100).toFixed(0)}% core-field coverage.`;
  return outputSchema.parse({status,data:{currency:input.currency,unit:input.unit,metrics,signals,sectorPolicy:policy,periodBasis:[...new Set(periods.map(period=>period.basis))]},
    reasoningChain:[`Normalized ${periods.length} periods before calculating trends and ratios.`,`Used average balance-sheet balances for ROE, ROA, DSO, DIO and DPO where a prior period existed.`,evidence],
    confidenceScore:Math.round(Math.min(95,45+completeness*40+(periods.length>=5?10:0))),citations,limitations,
    dataQuality:{status:completeness===1 && !issues.length?'verified':completeness>=.6?'review_required':'insufficient',completeness,issues,asOf:periods.at(-1)?.date ?? null},
    sourceLineage:periods.flatMap(period=>Object.keys(period.facts).flatMap(field=>period.sources.map(source=>({field:`${field}:${period.date}`,source,provider:period.provider,asOf:period.date,quality:period.sourceQuality})))),
  });
}

export function financialInputFromFoundation(data:{company:{ticker:string;currency:string;sector?:string|null};history:Array<{date:string;facts:Record<string,number>;sources:string[]}>;facts:Record<string,number>;fiscalDate:string|null;sources:string[];financialReview?:{reviewedAt:string;periods:Array<{date:string;days:number;sourceQuality:'primary'|'official_api'|'licensed_data'|'secondary'|'unknown'}>}}):FinancialStatementInput {
  const rows=[...data.history];
  if(data.fiscalDate && !rows.some(period=>period.date===data.fiscalDate) && data.sources.length) rows.push({date:data.fiscalDate,facts:data.facts,sources:data.sources});
  const periods=rows.map(row=>{const review=data.financialReview?.periods.find(period=>period.date===row.date);return {date:row.date,basis:'annual' as const,facts:row.facts,sources:row.sources,provider:'existing_financial_evidence',reviewed:!!review,days:review?.days,sourceQuality:review?.sourceQuality ?? 'unknown' as const};});
  return {ticker:data.company.ticker,currency:data.company.currency,unit:'base_currency',sector:data.company.sector,periods};
}
