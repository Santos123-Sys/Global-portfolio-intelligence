import { describe, expect, it } from 'vitest';
import { analyzeSchema, executionPlan, outputSchema } from '../src/lib/agent-finance/contracts';
import { createMockRegistry } from '../src/lib/agent-finance/l3/tool-registry';
import { buildAssumptions, dcfAgent } from '../src/lib/agent-finance/l1/dcf-swarm';
import { computedStatistics } from '../src/lib/agent-finance/l1/analysis-swarm';
import { discountedCashFlow } from '../src/lib/quant/dcf';
import type { Foundation } from '../src/lib/agent-finance/l4/foundation';

const foundation: Foundation = {
  company: { id: '00000000-0000-4000-8000-000000000001', ticker: 'TEST', companyName: 'Example', exchange: 'B3', currency: 'BRL', sector: null, industry: null, country: 'BR', isin: null },
  facts: { operating_income: 100, depreciation_and_amortization: 10, capital_expenditure: 20, change_in_non_cash_working_capital: 5, revenue: 500, net_income: 50, total_assets: 1000, total_equity: 500, total_debt: 200, cash_and_equivalents: 50, shares_outstanding: 100 },
  sources: ['https://issuer.example/filing'], fiscalDate: '2025-12-31', observations: [], documents: [], prices: [],history:[],wacc:null,terminalGrowth:undefined,peers:[],estimates:[],dataGaps:[],thesisContext:null,holdings:[],
};
const request = analyzeSchema.parse({ ticker: 'TEST', analysisType: 'dcf', userOverrides: { discountRate: .12, assumptions: { annualGrowthRate: .05, terminalGrowthRate: .02, taxRate: .25 } } });
Object.assign(foundation.facts,{non_cash_working_capital:100,interest_expense:10});

describe('financial swarm contracts and registry', () => {
  it('requires public audit summary and bounded confidence on every output', () => {
    expect(outputSchema.safeParse({ status: 'completed', data: {}, reasoningChain: [], confidenceScore: 101, citations: [], limitations: [] }).success).toBe(false);
  });
  it('routes JSON messages without leaking shared mutable state', async () => {
    const fixture = { values: [1, 2] }; const registry = createMockRegistry({ fetch_price_history: fixture });
    const result = await registry.invoke('fetch_price_history', { from: 'technical-analyst', to: 'fetch_price_history', messageType: 'request', payload: {}, timestamp: new Date().toISOString(), sessionId: foundation.company.id }) as typeof fixture;
    result.values.push(3); expect(fixture.values).toEqual([1, 2]); expect(registry.messages.map(row => row.messageType)).toEqual(['request', 'response']);
  });
  it('rejects invalid analysis types and unsafe modeling overrides', () => {
    expect(analyzeSchema.safeParse({ ticker: 'TEST', analysisType: 'combined', userOverrides: { timeHorizon: 99 } }).success).toBe(false);
    expect(executionPlan('combined').indexOf('sanity-checker')).toBeLessThan(executionPlan('combined').indexOf('analysis-director'));
    expect(executionPlan('quick')).not.toContain('judge-agent');
  });
});

describe('DCF swarm numerical safeguards', () => {
  it('blocks absent inputs instead of fabricating WACC and growth', () => {
    const result = buildAssumptions({ foundation, request: { ticker: 'TEST', analysisType: 'dcf' }, outputs: {} });
    expect(result.input).toBeNull(); expect(result.missing).toContain('reviewed_wacc');
  });
  it('derives unlevered FCFF and net debt from coherent facts', () => {
    const result = buildAssumptions({ foundation, request, outputs: {} });
    expect(result.input?.startingFreeCashFlow).toBe(60); expect(result.input?.netDebt).toBe(150);
  });
  it('constructs 49 sensitivity cells and three explicit scenarios', async () => {
    const output = await dcfAgent('sensitivity-analyst', { foundation, request, outputs: {} }, async input => discountedCashFlow(input));
    expect(output.data.matrix).toHaveLength(49); expect(output.data.scenarios).toHaveLength(3); expect(output.reasoningChain.length).toBeGreaterThan(0);
  });
  it('never divides by absent or zero denominators', () => {
    const statistics = computedStatistics({ ...foundation, facts: { ...foundation.facts, net_income: 0 } });
    expect(statistics.ratios.cashConversion).toBeNull(); expect(statistics.technical.sma200).toBeNull();
  });
});
