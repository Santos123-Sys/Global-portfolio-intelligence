import type OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyThesisPolicy, type DiscoveryRunRequest } from '@portfolio-intelligence/agentic-contract';
import { OpenAIAgenticPipeline } from '../src/openai-pipeline.js';
import { DISCOVERY_RESEARCH_GAP } from '../src/discovery-research.js';
import { portfolioId, thesis, thesisVersionId } from './fixtures.js';

const brazilId = '22222222-2222-4222-8222-222222222222';
function request(): DiscoveryRunRequest {
  return {
    thesis: { versionId: thesisVersionId, criteria: structuredClone(thesis) },
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
  it('enforces disabled web research and propagates the configured model policy',async()=>{
    const input=request();
    input.agentConfig={agentKind:'market_research',configVersion:2,name:'Research',scope:'Discover eligible issuers',promptAddendum:'Prefer official filings',enabledTools:['structured_universe'],runtimePolicy:{model:'gpt-6-sol',fallbackModel:null,reasoningEffort:'high',maxOutputTokens:4000,timeoutMs:60000,maxAttempts:2,maxToolCalls:10,sourceMaxAgeDays:180}};
    vi.stubGlobal('fetch',vi.fn());
    const {instance,parse}=pipeline(modelCandidate(input));
    const result=await instance.discoverSecurities(input);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.candidates[0].informationGaps).toContain(DISCOVERY_RESEARCH_GAP);
    expect(parse.mock.calls[0][0]).toMatchObject({model:'gpt-6-sol',reasoning:{effort:'high'},max_output_tokens:4000});
    expect(parse.mock.calls[0][1]).toMatchObject({timeout:60000,maxRetries:1});
  });
  it('never asks the model to waive an unverified structured hard rule', async () => {
    const input = request();
    input.thesis.criteria.portfolios[0].policy = { ...emptyThesisPolicy(), rules: [{ statement: 'ROIC minimum 15 percent FY2025', kind: 'hard', category: 'selection', metric: { field: 'roic', operator: 'gte', value: 15, unit: 'percent', period: 'FY2025' } }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ results: [] })));
    const { instance, parse } = pipeline(modelCandidate(input));
    await expect(instance.discoverSecurities(input)).rejects.toThrow(/unverified/);
    expect(parse).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
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
    input.thesis.criteria.portfolios.push({ role: 'brazilian_growth', currency: 'BRL', objective: 'Growth', inclusionCriteria: [], exclusionCriteria: [] });
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
    await expect(instance.discoverSecurities(request())).rejects.toThrow(/qualitative evidence is unavailable/);
    expect(parse).not.toHaveBeenCalled();
  });
});


it('filters before research, retains dated sources and reports deterministic funnel metrics', async () => {
  const input = request();
  input.thesis.criteria.portfolios[0].policy = { ...emptyThesisPolicy(), universe: { ...emptyThesisPolicy().universe, listingMarkets: ['XSWX'], sectorsExcluded: ['Financials'] } };
  input.universe[0].sector = 'Industrials';
  input.universe[0].attributes = { issuer_lei: 'SAME', listing_primary_status: 'Yes' };
  input.universe[1].sector = 'Financials';
  input.universe.push({ ...input.universe[0], ticker: 'CCC', attributes: { issuer_lei: 'SAME' } }, { ...input.universe[0], ticker: 'DDD', sector: null });
  const fetcher = vi.fn().mockResolvedValue(Response.json({ results: [{ url: 'https://example.test/report', content: 'Annual report overview', published_date: '2026-08-01' }] }));
  vi.stubGlobal('fetch', fetcher);
  const { instance, parse } = pipeline(modelCandidate(input));
  const result = await instance.discoverSecurities(input);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(parse).toHaveBeenCalledTimes(1);
  expect(result.screeningAudit).toMatchObject({ researchAttempted: 1, researchFailed: 0, modelCalls: 1 });
  expect(result.screeningAudit?.records.map(r => r.status).sort()).toEqual(['duplicate', 'eligible', 'ineligible', 'unverified']);
  expect(result.candidates[0].discoveryContext?.evidence[1]).toMatchObject({ tier: 'unclassified', publishedAt: '2026-08-01', snippet: 'Annual report overview' });
  expect(result.candidates[0].discoveryContext?.thesisVersionId).toBe(thesisVersionId);
});

it('returns an explicit empty result for hard failures without web or model calls', async () => {
  const input = request(); input.thesis.criteria.portfolios[0].policy = { ...emptyThesisPolicy(), universe: { ...emptyThesisPolicy().universe, listingMarkets: ['BVMF'] } };
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const { instance, parse } = pipeline({});
  const result = await instance.discoverSecurities(input);
  expect(result.portfolioOutcomes?.[0].status).toBe('no_candidates');
  expect(fetcher).not.toHaveBeenCalled(); expect(parse).not.toHaveBeenCalled();
});

it('keeps a successful portfolio when the other universe provider fails', async () => {
  const input = request(); input.portfolios.push({ id: brazilId, name: 'Brazil', role: 'brazilian_growth', baseCurrency: 'BRL', investmentObjective: 'Growth' });
  input.thesis.criteria.portfolios.push({ role: 'brazilian_growth', currency: 'BRL', objective: 'Growth', inclusionCriteria: [], exclusionCriteria: [] });
  input.universeFailures = [{ exchange: 'BVMF', reason: 'Provider unavailable' }];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ results: [] })));
  const result = await pipeline(modelCandidate(input)).instance.discoverSecurities(input);
  expect(result.portfolioOutcomes?.map(o => o.status)).toEqual(['candidates_found', 'failed']);
  expect(result.candidates).toHaveLength(1);
});

it('preserves trading currency independently of portfolio reporting currency through validation', async () => {
  const input = request(); const model = modelCandidate(input);
  input.universe[0].currency = 'USD';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ results: [] })));
  const result = await pipeline(model).instance.discoverSecurities(input);
  expect(result.candidates[0].currency).toBe('USD');
  expect(result.marketMandates[0].currency).toBe('CHF');
});

it('rejects a candidate that cites research retrieved only for another security', async () => {
  const input = request(); const model = modelCandidate(input);
  model.candidates[0].sourceUrls.push('https://example.test/BBB-research');
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
    const ticker = JSON.parse(init.body as string).query.startsWith('AAA ') ? 'AAA' : 'BBB';
    return Response.json({ results: [{ url: `https://example.test/${ticker}-research`, content: 'Evidence' }] });
  }));
  await expect(pipeline(model).instance.discoverSecurities(input)).rejects.toThrow(/another security's research/);
});
