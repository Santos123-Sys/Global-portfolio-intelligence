import { describe, expect, it } from 'vitest';
import { ThesisCriteria, emptyThesisPolicy } from '@portfolio-intelligence/agentic-contract';
import { criteriaFromPortfolioStrategy, PortfolioStrategyDraft, StrategyChatResponse } from '../src/lib/portfolio-strategy-chat';

const brazilianDraft = PortfolioStrategyDraft.parse({
  title: 'Brazilian Quality Growth', investorName: 'Gustavo', purpose: 'Compound capital in durable Brazilian companies.',
  timeHorizon: 'At least seven years', riskTolerance: 'Moderate; accept interim volatility for durable earnings growth.',
  reviewCadence: 'Quarterly and after a thesis-breaking event', markets: ['B3 (BVMF)'],
  globalConstraints: ['Maintain liquidity for planned spending.'],
  mandates: [{
    label: 'Brazilian Quality Growth', role: 'brazilian_growth', currency: 'BRL',
    objective: 'Own profitable Brazilian companies with durable growth.',
    inclusionCriteria: ['Positive free cash flow across a cycle'], exclusionCriteria: ['Persistent net debt growth'],
    policy: {
      ...emptyThesisPolicy(), name: 'Brazilian Quality Growth', strategy: 'Profitable long-term growth', horizon: 'At least seven years',
      targetHoldings: 12, maximumHoldings: 18,
      universe: { ...emptyThesisPolicy().universe, listingMarkets: ['BVMF'] },
      rules: [{ statement: 'Positive free cash flow across a cycle', kind: 'preference', category: 'selection' }],
    },
  }],
});

describe('conversational portfolio strategy contract', () => {
  it('keeps a clarification turn separate from a ready structured draft', () => {
    expect(StrategyChatResponse.parse({ reply: 'Which market should this cover?', status: 'clarifying', missingFields: ['Listing market'], draft: null }).status).toBe('clarifying');
    expect(() => StrategyChatResponse.parse({ reply: 'Ready', status: 'ready', missingFields: [], draft: null })).toThrow();
  });

  it('maps the reviewed interview result to the existing thesis contract and version', () => {
    const criteria = ThesisCriteria.parse(criteriaFromPortfolioStrategy(brazilianDraft, 3));
    expect(criteria).toMatchObject({
      version: 3,
      portfolios: [{ role: 'brazilian_growth', currency: 'BRL', policy: { universe: { listingMarkets: ['BVMF'] }, targetHoldings: 12, maximumHoldings: 18 } }],
      globalConstraints: ['Maintain liquidity for planned spending.', 'Risk posture: Moderate; accept interim volatility for durable earnings growth.', 'Review cadence: Quarterly and after a thesis-breaking event'],
    });
  });

  it('rejects non-contract fields or invented unbounded conversation payloads', () => {
    expect(PortfolioStrategyDraft.safeParse({ ...brazilianDraft, extra: true }).success).toBe(false);
    expect(PortfolioStrategyDraft.safeParse({ ...brazilianDraft, mandates: Array(9).fill(brazilianDraft.mandates[0]) }).success).toBe(false);
  });
});
