import { describe, expect, it } from 'vitest';
import { processJob } from '../src/process-job.js';
import { MemoryRepository } from './memory-repository.js';
import { portfolioId, runRequest } from './fixtures.js';
import type { DiscoveryRunRequest, MarketDiscoveryOutput } from '@portfolio-intelligence/agentic-contract';

describe('durable job processing', () => {
  it('persists a provider-grounded market discovery result without invoking security analysis', async () => {
    const repository = new MemoryRepository();
    const request: DiscoveryRunRequest = {
      thesis: runRequest.thesis,
      portfolios: [{
        id: portfolioId,
        name: 'Swiss Quality',
        role: 'swiss_quality',
        baseCurrency: 'CHF',
        investmentObjective: 'Durable compounding',
      }],
      universe: [{
        ticker: 'NESN',
        exchange: 'XSWX',
        companyName: 'Nestle SA',
        currency: 'CHF',
        country: 'Switzerland',
        sector: 'Consumer Defensive',
        industry: 'Packaged Foods',
        assetType: 'Listed Equity',
        observedAt: '2026-08-29T12:00:00.000Z',
        provider: 'eodhd',
        sourceUrl: 'https://eodhd.com/financial-apis/stock-market-screener-api',
        attributes: { dividend_yield: 0.03 },
      }],
      maxCandidatesPerPortfolio: 5,
    };
    const result: MarketDiscoveryOutput = {
      thesisVersion: request.thesis.criteria.version,
      marketMandates: [{
        portfolioId,
        role: 'swiss_quality',
        exchanges: ['XSWX'],
        currency: 'CHF',
        rationale: 'Matches the confirmed Swiss-quality mandate.',
      }],
      candidates: [{
        portfolioId,
        ticker: 'NESN',
        exchange: 'XSWX',
        companyName: 'Nestle SA',
        currency: 'CHF',
        country: 'Switzerland',
        sector: 'Consumer Defensive',
        thesisAlignmentScore: 80,
        rationale: 'Provider evidence supports initial review.',
        matchedCriteria: ['Swiss listing'],
        violatedCriteria: [],
        groundedIn: ['identity:exchange', 'attribute:dividend_yield'],
        sourceUrls: ['https://eodhd.com/financial-apis/stock-market-screener-api'],
        informationGaps: ['Recurring cash flow is not in screener data'],
      }],
      verifiedWebSources: [],
      limitations: ['Bounded provider universe'],
    };
    await repository.create('market_discovery', 'discovery-process', request, 1);
    const job = (await repository.claimNext('worker-1', 300))!;
    await processJob(job, {
      repository,
      pipeline: {
        extractThesis: async () => { throw new Error('not used'); },
        discoverSecurities: async () => result,
        researchMarket: async () => { throw new Error('not used'); },
      },
    });
    const completed = await repository.findByExternalId('discovery-process');
    expect(completed?.status).toBe('completed');
    expect(completed?.result).toEqual(result);
  });

  it('fails closed when a historical analysis_run reaches the generic worker', async () => {
    const repository = new MemoryRepository();
    await repository.create('analysis_run', 'legacy-analysis-run', runRequest, 4);
    const job = (await repository.claimNext('worker-1', 300))!;
    await processJob(job, {
      repository,
      pipeline: {
        extractThesis: async () => { throw new Error('not used'); },
        discoverSecurities: async () => { throw new Error('not used'); },
        researchMarket: async () => { throw new Error('not used'); },
      },
    });
    const failed = await repository.findByExternalId('legacy-analysis-run');
    expect(failed).toMatchObject({
      status: 'failed',
      failedStage: 'analysis',
      errorMessage: 'Legacy security-analysis orchestration is retired. Start a canonical Research Director session instead.',
    });
    expect(failed?.result).toBeNull();
  });
});
