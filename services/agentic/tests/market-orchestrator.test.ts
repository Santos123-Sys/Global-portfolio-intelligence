import { describe, expect, it, vi } from 'vitest';
import { executeMarketAnalysis } from '../src/market-orchestrator.js';
import { marketContextFromRecord, type GroundingBundle } from '@portfolio-intelligence/agentic-contract';
const bundle: GroundingBundle = { ticker: 'TEST', companyName: 'Test SA', exchange: 'BVMF', country: null, currency: 'BRL', sector: 'Materials', computedMetrics: {}, fundamentals: {}, dataAsOf: '2026-09-28T00:00:00Z', researchEvidence: { 'filing:1': 'Issuer reports commodity exports.' } };
const finding = { status: 'complete', claims: [{ statement: 'Commodity export exposure needs review.', evidenceRefs: ['filing:1'] }], risks: [{ statement: 'Commodity price sensitivity.', evidenceRefs: ['filing:1'], assumption: 'growth', scenario: 'worst_case', direction: 'decrease' }], missingInputs: [] };
describe('executable market module DAG', () => {
  it('runs the triggered Brazil modules, blocks unsupported forecasts and retains a risk review', async () => {
    const reason = vi.fn(async () => finding);
    const result = await executeMarketAnalysis(bundle, reason);
    expect(result.executions.find(e => e.agent === 'FinancialStatementAgent')?.status).toBe('insufficient_data');
    expect(result.executions.find(e => e.agent === 'ForecastingAgent')?.status).toBe('blocked');
    expect(result.executions.find(e => e.agent === 'CountryRiskAgent')?.status).toBe('complete');
    expect(result.executions.find(e => e.agent === 'CommodityFXAgent')?.status).toBe('complete');
    expect(result.executions.find(e => e.agent === 'RiskAgent')?.finding?.risks[0].assumption).toBe('growth');
  });
  it('rejects fabricated citations and records provider failure instead of claiming success', async () => {
    const result = await executeMarketAnalysis(bundle, async () => ({ ...finding, claims: [{ statement: 'Invented', evidenceRefs: ['unknown:99'] }] }));
    expect(result.executions.some(e => e.status === 'error')).toBe(true);
    const failed = await executeMarketAnalysis(bundle, async () => { throw new Error('provider unavailable'); });
    expect(failed.executions.filter(e => e.status === 'complete')).toHaveLength(0);
  });
  it('executes dependencies before forecasting and records contradictory scenario directions', async () => {
    const full = { ...bundle, fundamentals: { 'fundamental:revenue:1': 100 }, marketContext: marketContextFromRecord(bundle) };
    const result = await executeMarketAnalysis(full, async agent => ({ ...finding, risks: [{ ...finding.risks[0], direction: agent === 'CountryRiskAgent' ? 'increase' : 'decrease' }] }));
    expect(result.executions.find(e => e.agent === 'ForecastingAgent')?.status).toBe('complete');
    expect(result.conflicts[0].code).toBe('growth:worst_case');
    expect(result.executions.find(e => e.agent === 'DCFAgent')?.status).toBe('insufficient_data');
  });
});
