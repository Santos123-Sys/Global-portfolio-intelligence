import {describe,it,expect,vi} from 'vitest';
import {calculateWacc,projectStatements,valueProjection,sensitivityAnalysis,type Drivers} from '../src/lib/agent-finance/l4/financial-model';
import {technicalIndicators} from '../src/lib/agent-finance/l4/technical';
import {validateQuality} from '../src/lib/agent-finance/l3/quality';
import {evidenceOutput} from '../src/lib/agent-finance/contracts';
import {canAcceptReport} from '../src/lib/agent-finance/l3/review';
import {fetchCapitalInputs} from '../src/lib/agent-finance/l4/capital-source';

const facts={revenue:1000,operating_income:150,depreciation_and_amortization:30,capital_expenditure:50,total_assets:800,total_equity:400,total_debt:200,cash_and_equivalents:100,non_cash_working_capital:100};
const drivers:Drivers={growth:.05,operatingMargin:.15,depreciationRatio:.03,capexRatio:.05,workingCapitalRatio:.1,taxRate:.25,debtRate:.05,payoutRatio:.2,minimumCash:50};
describe('linked statements and deterministic valuation',()=>{
  it('reconciles each statement without an unexplained cash/equity plug',()=>{
    const model=projectStatements(facts,drivers,5),first=model.projections[0];
    expect(first.incomeStatement.revenue).toBe(1050);
    expect(first.incomeStatement.netIncome).toBeCloseTo(110.625);
    expect(first.cashFlow.fcff).toBeCloseTo(92.125);
    expect(first.balanceSheet.cash).toBeCloseTo(162.5);
    for(const row of model.projections) {expect(row.checks.balanceError).toBeCloseTo(0,8);expect(row.checks.cashError).toBeCloseTo(0,8);}
  });
  it('handles explicit debt draws and negative earnings while reconciling statements',()=>{
    const model=projectStatements(facts,{...drivers,operatingMargin:-.1,capexRatio:.1},5);
    expect(model.projections[0].cashFlow.borrowing).toBeGreaterThan(0);
    expect(model.projections[0].balanceSheet.cash).toBeCloseTo(50);
    expect(model.projections[0].incomeStatement.taxes).toBe(0);
    model.projections.forEach(row=>expect(row.checks.balanceError).toBeCloseTo(0,8));
  });
  it('blocks missing opening balances and invalid terminal rates',()=>{
    expect(()=>projectStatements({...facts,non_cash_working_capital:NaN},drivers,5)).toThrow('Missing opening');
    expect(()=>valueProjection(projectStatements(facts,drivers,5),.02,.02,100,10)).toThrow();
  });
  it('values projected flows under both terminal approaches',()=>{
    const model=projectStatements(facts,drivers,5),result=valueProjection(model,.1,.02,100,10);
    const last=model.projections.at(-1)!;
    const explicit=model.projections.reduce((sum,row)=>sum+row.cashFlow.fcff/1.1**row.year,0);
    expect(result.enterpriseValue).toBeCloseTo(explicit+last.cashFlow.fcff*1.02/.08/1.1**5);
    expect(valueProjection(model,.1,.02,100,10,8).terminalValue).toBeCloseTo(last.incomeStatement.ebitda*8);
  });
  it('runs reproducible reviewed Monte Carlo, probabilities and driver sensitivities',()=>{
    const policy={samples:1000,seed:42,growthWidth:.02,marginWidth:.01,waccWidth:.01,probabilities:[.25,.5,.25] as [number,number,number]};
    const result=sensitivityAnalysis(facts,drivers,5,.1,.02,100,10,policy);
    expect(result).toEqual(sensitivityAnalysis(facts,drivers,5,.1,.02,100,10,policy));
    expect(result.matrix).toHaveLength(49);expect(result.tornado).toHaveLength(3);
    expect(result.monteCarlo?.histogram.reduce((s,row)=>s+row.count,0)).toBe(1000);
    expect(result.monteCarlo!.p5).toBeLessThan(result.monteCarlo!.p95);
    expect(result.probabilityWeightedValue).toBeCloseTo(result.scenarios.reduce((sum,row)=>sum+row.fairValuePerShare*row.probability!,0));
    expect(sensitivityAnalysis(facts,drivers,5,.1,.02,100,10).monteCarlo).toBeNull();
    expect(()=>sensitivityAnalysis(facts,drivers,5,.1,.02,100,10,{...policy,probabilities:[.5,.5,.5]})).toThrow('sum to one');
  });
});
describe('CAPM and technical statistics',()=>{
  const capital={riskFreeRate:.04,beta:1.2,equityRiskPremium:.05,countryRiskPremium:.02,costOfDebt:.08,taxRate:.25,debtWeight:.2,sources:['https://source.example/rates'],currency:'BRL',asOf:'2026-09-30'};
  it('calculates CAPM with after-tax debt cost and explicit country premium',()=>{
    const result=calculateWacc(capital);expect(result.costOfEquity).toBeCloseTo(.12);expect(result.wacc).toBeCloseTo(.108);
  });
  it('computes Wilder RSI and EMA indicators without filling unavailable observations',()=>{
    expect(technicalIndicators(Array.from({length:40},(_,i)=>({close:100+i,volume:1000}))).rsi14).toBe(100);
    const flat=technicalIndicators(Array.from({length:40},()=>({close:100})));
    expect(flat.rsi14).toBe(50);expect(flat.macd).toBeCloseTo(0);expect(flat.macdSignal).toBeCloseTo(0);expect(flat.bollinger).toEqual({middle:100,upper:100,lower:100});expect(flat.averageVolume20).toBeNull();
    expect(technicalIndicators([{close:100}]).rsi14).toBeNull();
  });
  it('rejects mismatched and stale canonical feed inputs',async()=>{
    vi.stubEnv('FINANCE_CAPITAL_DATA_URL','https://feed.example/capital');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({...capital,currency:'USD'}))));
    await expect(fetchCapitalInputs('TEST','BRL')).rejects.toThrow('mismatched');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({...capital,asOf:'2020-01-01'}))));
    await expect(fetchCapitalInputs('TEST','BRL')).rejects.toThrow('Stale');
    vi.unstubAllGlobals();vi.unstubAllEnvs();
  });
});
describe('source QA and human-review gates',()=>{
  it('rejects uncited claims and invented evidence, even with a known URL',()=>{
    const output={...evidenceOutput({},['Audit'],['source']),claims:[{text:'Revenue rose',citations:[],evidence:'invented'}]};
    expect(validateQuality(output,{source:'actual filing text'})).toHaveLength(2);
    const valid={...output,claims:[{text:'Revenue is 100',citations:['source'],evidence:'Revenue: 100'}]};
    expect(validateQuality(valid,{source:'Revenue: 100'})).toEqual([]);
  });
  it('blocks low-confidence, incomplete, and non-debate reports from accepted history',()=>{
    const judge=evidenceOutput({investmentScore:70},['Balanced research'],['source']);
    expect(canAcceptReport({status:'completed',confidenceScore:75,outputs:{'judge-agent':judge}})).toBe(true);
    expect(canAcceptReport({status:'completed',confidenceScore:59,outputs:{'judge-agent':judge}})).toBe(false);
    expect(canAcceptReport({status:'insufficient_data',confidenceScore:75,outputs:{'judge-agent':judge}})).toBe(false);
    expect(canAcceptReport({status:'completed',confidenceScore:75,outputs:{'projection-builder':judge}})).toBe(false);
  });
});
