import type OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryRunRequest } from '@portfolio-intelligence/agentic-contract';
import { OpenAIAgenticPipeline } from '../src/openai-pipeline.js';
import { DISCOVERY_RESEARCH_GAP } from '../src/discovery-research.js';
import { portfolioId, thesis, thesisVersionId } from './fixtures.js';

const brazilId = '22222222-2222-4222-8222-222222222222';
function request(): DiscoveryRunRequest {
  return {
    thesis: { versionId: thesisVersionId, criteria: thesis },
    portfolios: [{ id: portfolioId, name: 'Swiss', role: 'swiss_quality', baseCurrency: 'CHF', investmentObjective: 'Quality' }],
    universe: ['AAA', 'BBB'].map(ticker => ({ ticker, exchange: 'XSWX', companyName: ticker, currency: 'CHF', country: 'CH', sector: null, industry: null, assetType: 'Common Stock', observedAt: '2026-09-26T00:00:00.000Z', provider: 'test', sourceUrl: `https://example.test/${ticker}`, attributes: {} })),
    maxCandidatesPerPortfolio: 3,
  };
}
function modelCandidate(req: DiscoveryRunRequest, index = 0) {
  const record = req.universe[index];
  const portfolio = req.portfolios.find(p => p.baseCurrency === record.currency)!;
  return { marketMandates: [{ portfolioId: portfolio.id, role: portfolio.role, currency: portfolio.baseCurrency, exchanges: [record.exchange], rationale: 'Supplied market' }], candidates: [{
    portfolioId: portfolio.id, ticker: record.ticker, exchange: record.exchange, companyName: record.companyName, currency: record.currency, country: record.country,
    sector: null, industry: null, classificationSource: 'unclassified', thesisAlignmentScore: 50, rationale: 'Research lead', matchedCriteria: [], violatedCriteria: [], groundedIn: ['identity:ticker'], sourceUrls: [record.sourceUrl], informationGaps: [],
  }], limitations: [] };
}
function pipeline(parsed: unknown) {
  const parse = vi.fn().mockResolvedValue({ output_parsed: parsed, output: [] });
  return { parse, instance: new OpenAIAgenticPipeline('unused', 'test-model', 'medium', { responses: { parse } } as unknown as OpenAI, { provider: 'tavily', apiKey: 'test' }) };
}
afterEach(() => vi.unstubAllGlobals());

describe('discovery research failure isolation', () => {
  it('retains a partial shortlist while adding a service-owned gap and limitation', async () => {
    const input = request();
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => JSON.parse(init.body as string).query.startsWith('AAA ')
      ? new Response('', { status: 401 }) : Response.json({ results: [] })));
    const { instance } = pipeline(modelCandidate(input));
    const result = await instance.discoverSecurities(input);
    expect(result.candidates[0].informationGaps).toContain(DISCOVERY_RESEARCH_GAP);
    expect(result.limitations.join(' ')).toContain('XSWX:AAA');
    expect(result.portfolioOutcomes?.[0].status).toBe('candidates_found');
  });
  it('does not turn incomplete zero-result research into a no-match conclusion', async () => {
    const input = request();
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => JSON.parse(init.body as string).query.startsWith('AAA ')
      ? new Response('', { status: 401 }) : Response.json({ results: [] })));
    const result = modelCandidate(input); result.candidates = [];
    await expect(pipeline(result).instance.discoverSecurities(input)).rejects.toThrow(/partial assessment/);
  });
  it('preserves a successful market when another market has no retrievable research', async () => {
    const input = request();
    input.portfolios.push({ id: brazilId, name: 'Brazil', role: 'brazilian_growth', baseCurrency: 'BRL', investmentObjective: 'Growth' });
    input.universe[1] = { ...input.universe[1], currency: 'BRL', exchange: 'BVMF' };
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => JSON.parse(init.body as string).query.startsWith('AAA ')
      ? new Response('', { status: 401 }) : Response.json({ results: [] })));
    const { instance, parse } = pipeline(modelCandidate(input, 1));
    const result = await instance.discoverSecurities(input);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(result.candidates.map(c => c.ticker)).toEqual(['BBB']);
    expect(result.portfolioOutcomes?.map(o => o.status)).toEqual(['failed', 'candidates_found']);
  });
  it('skips the model when every retrieval fails and returns an actionable failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    const { instance, parse } = pipeline({});
    await expect(instance.discoverSecurities(request())).rejects.toThrow(/eligibility was not assessed/);
    expect(parse).not.toHaveBeenCalled();
  });
});
