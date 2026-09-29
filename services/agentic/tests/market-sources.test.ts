import { afterEach, describe, expect, it, vi } from 'vitest';
import { retrieveBrapiIndicators, retrieveMaritacaBrazilResearch, retrieveSecIssuerEvidence } from '../src/market-sources.js';
import type { MarketBriefRequest } from '@portfolio-intelligence/agentic-contract';

const request = (overrides: Partial<MarketBriefRequest['security']> = {}): MarketBriefRequest => ({
  dispatchId: '7e5a08ad-8a4c-4c74-a58f-f8e9dcbd813e',
  thesisVersionId: 'b2fd6d22-c3fd-43a0-a254-024787535a16',
  candidateId: '125a588b-6848-4a39-85bd-0056e65c9a46',
  thesis: { version: 1, portfolios: [{ role: 'brazilian_growth', currency: 'BRL', objective: 'Growth', inclusionCriteria: [], exclusionCriteria: [], targetMetrics: [] }], globalConstraints: [] },
  security: { ticker: 'PETR4', exchange: 'BVMF', companyName: 'Petroleo Brasileiro SA', currency: 'BRL', country: 'Brazil', sector: 'Energy', industry: 'Oil & Gas', ...overrides },
  discoveryEvidence: { rationale: 'Candidate meets the saved thesis.', matchedCriteria: [], violatedCriteria: [], informationGaps: [], sourceUrls: [] },
});

afterEach(() => vi.unstubAllGlobals());

describe('market research data sources', () => {
  it('retrieves only the requested BrAPI financial indicator and retains the provider source', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ symbol: 'PETR4', financialData: { revenue: 10, ebitda: 2 } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const evidence = await retrieveBrapiIndicators(request(), 'secret-token');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].sourceKind).toBe('market_data');
    expect(evidence[0].excerpt).toContain('PETR4');
    expect(String(fetchMock.mock.calls[0][0])).toContain('symbols=PETR4');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer secret-token' });
  });

  it('does not call BrAPI for non-B3 securities or without a key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await retrieveBrapiIndicators(request({ exchange: 'NYSE' }), 'key')).toEqual([]);
    expect(await retrieveBrapiIndicators(request(), undefined)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls Maritaca Data Ocean through the supported Sabiá tool and captures cited HTTPS sources', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: 'Banco Central published the SELIC series. Source: https://www.bcb.gov.br/estabilidadefinanceira/selic',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const evidence = await retrieveMaritacaBrazilResearch(request(), 'maritaca-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { tools: Array<{ type: string }>; model: string };
    expect(body.model).toBe('sabia-4-thinking');
    expect(body.tools).toEqual([{ type: 'data_ocean' }]);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].sourceKind).toBe('official_statistics');
    expect(evidence[0].url).toBe('https://www.bcb.gov.br/estabilidadefinanceira/selic');
  });

  it('retrieves US SEC facts only after an exact ticker mapping and issuer-name match', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ fields: ['cik', 'name', 'ticker', 'exchange'], data: [['320193', 'Apple Inc.', 'AAPL', 'Nasdaq']] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ cik: 320193, entityName: 'Apple Inc.', facts: { 'us-gaap': {
        Revenues: { units: { USD: [{ val: 1000, end: '2025-09-27', filed: '2025-10-31', form: '10-K', fy: 2025, fp: 'FY' }] } },
      } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const evidence = await retrieveSecIssuerEvidence(request({ ticker: 'AAPL', exchange: 'NASDAQ', companyName: 'Apple Inc.', country: 'United States' }), 'Research contact@example.com');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].url).toContain('data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json');
    expect(evidence[0].publisher).toContain('U.S. Securities and Exchange Commission');
    expect(evidence[0].excerpt).toContain('"revenue"');
    expect(evidence[0].excerpt).toContain('2025-09-27');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
