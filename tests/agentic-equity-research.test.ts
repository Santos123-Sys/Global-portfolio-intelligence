import {describe,it,expect} from 'vitest';
import {financialStatementInputSchema,analyzeFinancialStatements,financialInputFromFoundation} from '../src/lib/agent-finance/l4/financial-statement-analyzer';
import {inferResearchMarket, researchProviderPolicy,resolveResearchProfile} from '../src/lib/agent-finance/research-policy';
import {calculateValueScorecard,VALUE_CRITERIA,thesisResearchPolicy} from '../src/lib/agent-finance/l4/research-modules';
import {emptyThesisPolicy,ThesisCriteria,ValueScorecardPolicy} from '@portfolio-intelligence/agentic-contract';
import {controlTransition,runBriefing,SessionInterrupted} from '../src/lib/agent-finance/l3/session-control';
import {ToolRegistry} from '../src/lib/agent-finance/l3/tool-registry';
import {readFileSync} from 'node:fs';
import {effectiveConfig,selectPrior} from '../src/lib/agent-governance';
import {outputSchema} from '../src/lib/agent-finance/contracts';

const source='https://issuer.example/annual';
const facts={revenue:100,net_income:10,operating_cash_flow:12,total_assets:200,total_equity:100,current_assets:50,current_liabilities:40,accounts_receivable:20,inventory:10,accounts_payable:5,cost_of_revenue:60,capital_expenditure:-3};
const input=()=>financialStatementInputSchema.parse({ticker:'TEST',currency:'BRL',periods:[{date:'2024-12-31',facts,sources:[source],days:366},{date:'2025-12-31',facts:{...facts,revenue:120,net_income:12,total_equity:140,accounts_receivable:50},sources:[source],days:365}]});

describe('deterministic financial statement tool',()=>{
  it('requires reviewed durations and primary provenance without changing retained numbers',()=>{
    const base={company:{ticker:'TEST',currency:'BRL'},history:input().periods,facts,fiscalDate:'2025-12-31',sources:[source]};
    expect(analyzeFinancialStatements(financialInputFromFoundation(base)).dataQuality?.status).toBe('review_required');
    const reviews:Array<{date:string;days:number;sourceQuality:'official_api'|'secondary'}>=base.history.map(row=>({date:row.date,days:365,sourceQuality:'official_api'}));
    const reviewed={...base,financialReview:{reviewedAt:new Date().toISOString(),periods:reviews}};
    const normalized=financialInputFromFoundation(reviewed);
    expect(analyzeFinancialStatements(normalized).dataQuality?.status).toBe('verified');
    expect(normalized.periods[1].facts).toEqual(base.history[1].facts);
    reviewed.financialReview.periods[0].sourceQuality='secondary';
    expect(analyzeFinancialStatements(financialInputFromFoundation(reviewed)).dataQuality?.status).toBe('review_required');
  });
  it('uses average balance denominators, positive spend and finite ratios',()=>{
    const output=analyzeFinancialStatements(input());const metrics=output.data.metrics as Array<Record<string,number>>;
    expect(metrics[1].returnOnEquity).toBeCloseTo(12/120);
    expect(metrics[1].dso).toBeCloseTo(35/120*365);
    expect(metrics[1].freeCashFlow).toBe(9);
    expect(metrics[1].revenueYoY).toBeCloseTo(.2);
    expect(metrics[1].revenueQoQ).toBeNull();
    expect(output.sourceLineage?.some(row=>row.field==='revenue:2025-12-31')).toBe(true);
    expect((output.data.signals as Array<{code:string}>).some(row=>row.code==='AR_GROWTH_DIVERGENCE')).toBe(true);
  });
  it('normalizes YTD flows without subtracting balance-sheet payables',()=>{
    const raw=input();raw.periods=financialStatementInputSchema.parse({...raw,periods:[{date:'2025-03-31',basis:'quarterly_ytd',fiscalYear:'2025',fiscalQuarter:1,facts,sources:[source],provider:'test'},{date:'2025-06-30',basis:'quarterly_ytd',fiscalYear:'2025',fiscalQuarter:2,facts:{...facts,revenue:240,operating_cash_flow:30,accounts_payable:20},sources:[source],provider:'test'}]}).periods;
    const metrics=analyzeFinancialStatements(raw).data.metrics as Array<Record<string,number>>;
    expect(metrics[1].revenueQoQ).toBeCloseTo(.4);
    expect(metrics[1].freeCashFlow).toBe(18);
    expect(metrics[1].dpo).toBeNull(); // Zero discrete-quarter COGS is not a valid denominator.
  });
  it('rejects duplicate, mixed-currency and incomplete YTD inputs',()=>{
    const raw=input();raw.periods[1].date=raw.periods[0].date;expect(()=>analyzeFinancialStatements(raw)).toThrow('Duplicate');
    const mixed=input();mixed.periods[1].currency='USD';expect(()=>analyzeFinancialStatements(mixed)).toThrow('currencies');
    const ytd=input();ytd.periods[1].basis='quarterly_ytd';ytd.periods[1].fiscalQuarter=2;ytd.periods[1].fiscalYear='2025';expect(()=>analyzeFinancialStatements(ytd)).toThrow('preceding');
  });
  it('does not divide by zero or negative equity, or call liabilities interest-bearing debt',()=>{
    const raw=input();raw.periods=raw.periods.map(row=>({...row,facts:{...row.facts,revenue:0,total_equity:-100,total_liabilities:190}}));
    const output=analyzeFinancialStatements(raw);const metrics=output.data.metrics as Array<Record<string,number>>;
    expect(metrics[1].grossMargin).toBeNull();expect(metrics[1].returnOnEquity).toBeNull();expect(metrics[1].liabilitiesToAssets).toBe(.95);
    expect(JSON.stringify(output)).not.toContain('NaN');
  });
  it('suppresses generic bank liquidity/leverage rules while retaining the audit signal',()=>{
    const raw=input();raw.sector='Banking';raw.periods[1].facts.current_liabilities=200;raw.periods[1].facts.total_liabilities=190;
    const signals=analyzeFinancialStatements(raw).data.signals as Array<{code:string;ruleStatus:string}>;
    expect(signals.find(row=>row.code==='LOW_CURRENT_RATIO')?.ruleStatus).toBe('sector_suppressed');
    expect(signals.find(row=>row.code==='HIGH_LIABILITIES_RATIO')?.ruleStatus).toBe('sector_suppressed');
  });
  it('withholds nonconsecutive growth and distinguishes missing coverage from no anomalies',()=>{
    const raw=input();raw.periods[0].date='2020-12-31';delete raw.periods[1].facts.operating_cash_flow;
    const output=analyzeFinancialStatements(raw);expect(output.status).toBe('insufficient_data');
    expect((output.data.metrics as Array<Record<string,unknown>>)[1].revenueGrowth).toBeNull();
    expect(output.dataQuality?.status).toBe('review_required');
  });
});

describe('research routing and thesis optional scorecard',()=>{
  const policy={enabled:true,weights:{moat:.25,management:.25,financials:.25,valuation:.25},minimumEvidenceCoverage:.8};
  const criteria=Object.values(VALUE_CRITERIA).flat().map(id=>({id,score:4,applicable:true,rationale:'Sector-relative evidence.',confidence:.8,citations:[source],evidence:'Retained evidence'}));
  it('routes B3 to BrAPI and never infers domicile/market from reporting currency',()=>{
    expect(inferResearchMarket({exchange:'BVMF',currency:'USD'})).toBe('BR');
    expect(inferResearchMarket({currency:'BRL'})).toBe('OTHER');
    expect(researchProviderPolicy.BR.securityMaster[0]).toBe('brapi');
    expect(researchProviderPolicy.US.filings[0]).toBe('sec_edgar');
  });
  it('resolves actual output locale without allowing market spoofing',()=>{
    expect(resolveResearchProfile({country:'BR'}).locale).toBe('pt-BR');
    expect(resolveResearchProfile({country:'BR'},{locale:'de'},'pt-BR').locale).toBe('de');
    expect(()=>resolveResearchProfile({country:'BR'},{market:'US'})).toThrow('conflicts');
  });
  it('registers the new tools under governance and shares financial checks without leaking sibling analyses',async()=>{
    const config=effectiveConfig('financial-statement-analyzer');
    const registry=new ToolRegistry({sessionId:'00000000-0000-4000-8000-000000000001',configs:{'financial-statement-analyzer':config},trace:async()=>{}}).register('analyze_financial_statements',async()=>analyzeFinancialStatements(input()));
    const output=outputSchema.parse(await registry.invoke('analyze_financial_statements',{from:'financial-statement-analyzer',to:'analyze_financial_statements',messageType:'request',payload:{},timestamp:new Date().toISOString(),sessionId:'00000000-0000-4000-8000-000000000001'}));
    expect(output).toMatchObject({status:'completed'});
    expect(selectPrior('quality-analyst',{'financial-statement-analyzer':output,'fundamental-analyst':output})).toHaveProperty('financial-statement-analyzer');
    expect(selectPrior('quality-analyst',{'fundamental-analyst':output})).not.toHaveProperty('fundamental-analyst');
  });
  it('persists pt-BR and scorecard weights in the investor-approved thesis',()=>{
    const thesis=ThesisCriteria.parse({version:1,portfolios:[{role:'brazilian_growth',currency:'BRL',objective:'Growth',inclusionCriteria:[],exclusionCriteria:[],policy:{...emptyThesisPolicy(),research:{locale:'pt-BR',valueScorecard:policy}}}],globalConstraints:[]});
    expect(thesisResearchPolicy(thesis,'brazilian_growth')?.locale).toBe('pt-BR');
    expect(thesisResearchPolicy(thesis,'swiss_quality')).toBeNull();
    expect(ValueScorecardPolicy.safeParse({...policy,weights:{...policy.weights,moat:.5}}).success).toBe(false);
  });
  it('only calculates a review-only total for validated evidence and data quality',()=>{
    const calculate=(dataQuality:string,evidence='Retained evidence')=>calculateValueScorecard({policy,criteria,sourceEvidence:{[source]:evidence},dataQuality});
    expect(calculate('verified')).toMatchObject({status:'review_required',total:75,requiresHumanReview:true});
    expect(calculate('review_required').total).toBeNull();
    expect(calculate('verified','Unrelated text').total).toBeNull();
    expect(calculateValueScorecard({policy:{...policy,enabled:false},criteria,sourceEvidence:{[source]:'Retained evidence'},dataQuality:'verified'}).status).toBe('disabled');
  });
  it('rejects duplicate criteria and penalizing not-applicable inputs',()=>{
    const duplicate=[...criteria];duplicate[0]={...criteria[1]};expect(()=>calculateValueScorecard({policy,criteria:duplicate,sourceEvidence:{},dataQuality:'verified'})).toThrow();
    const notApplicable=criteria.map((row,index)=>index===0?{...row,applicable:false}:row);expect(()=>calculateValueScorecard({policy,criteria:notApplicable,sourceEvidence:{},dataQuality:'verified'})).toThrow();
  });
});

describe('authority, interruption and user visibility',()=>{
  it('only allows safe explicit state transitions, never timeout approval',()=>{
    expect(controlTransition('running','pause')).toBe('paused');expect(controlTransition('paused','resume')).toBe('queued');expect(controlTransition('running','cancel')).toBe('cancelled');
    expect(controlTransition('cancelled','resume')).toBeNull();expect(controlTransition('completed','retry')).toBeNull();expect(controlTransition('failed','retry')).toBe('queued');
    expect(new SessionInterrupted().message).toContain('lease lost');
  });
  it('produces a return briefing that retains partial-success visibility',()=>{
    const result=runBriefing({status:'failed'},[{agentName:'financial-statements',status:'completed'},{agentName:'quality-analyst',status:'failed'}]);
    expect(result.completed).toEqual(['financial-statements']);expect(result.gaps).toEqual(['quality-analyst']);expect(result.requiresHumanReview).toBe(true);
    expect(result.outcome).toContain('stopped');expect(result.nextAction).toContain('retry');expect(result.reportCanBeAccepted).toBe(false);
  });
  it('summarizes completed research without implying approval or hiding key risks',()=>{
    const result=runBriefing({status:'completed',requestPayload:{portfolioId:'portfolio'},finalOutput:{status:'completed',confidenceScore:72,citations:['filing-a','filing-a','news-b'],limitations:['Peer data unavailable'],outputs:{'judge-agent':{status:'completed',data:{findings:['Margin expansion supported'],keyRisks:['Debt refinancing risk']}}}}},[{agentName:'judge-agent',status:'completed'}]);
    expect(result).toMatchObject({outcome:'Validated evidence-backed research is ready for your review.',keyFindings:['Margin expansion supported'],keyRisks:['Debt refinancing risk'],limitations:['Peer data unavailable'],confidenceScore:72,sourceCount:2,reportCanBeAccepted:true,requiresHumanReview:true});
    expect(result.nextAction).toContain('explicitly accept');
  });
  it('rejects misrouted JSON envelopes',async()=>{
    const registry=new ToolRegistry().register('fetch_news',async()=>[]);
    await expect(registry.invoke('fetch_news',{from:'research-director',to:'run_dcf',messageType:'request',payload:{},timestamp:new Date().toISOString(),sessionId:'00000000-0000-4000-8000-000000000001'})).rejects.toThrow('scope');
  });
  it('keeps controls authenticated, owner-scoped, CSRF checked and active-thesis-bound',()=>{
    const route=readFileSync('src/app/api/agents/sessions/[sessionId]/control/route.ts','utf8');
    for(const text of ['authenticateRequest(req)','assertSameOrigin(req)','eq(agentAnalysisSessions.ownerId,auth.auth.userId)','analysisScopes','pg_advisory_xact_lock','eq(agentAnalysisSessions.status,session.status)']) expect(route).toContain(text);
    const component=readFileSync('src/components/dashboard/agent-run-status.tsx','utf8');
    for(const text of ['Pause research','Resume research','Cancel research','Return briefing','Meaningful activity','Key findings','Risks and opposing evidence','Evidence limitations']) expect(component).toContain(text);
    const analysis=readFileSync('src/components/dashboard/agent-analysis.tsx','utf8');
    for(const text of ['Review research plan','Confirm plan and start research','No work started yet','Research language','Standalone research; no thesis-linked acceptance','Optional value scorecard']) expect(analysis).toContain(text);
  });
});
