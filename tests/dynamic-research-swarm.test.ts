import { describe, expect, it, vi } from 'vitest';
import { dynamicResearchBudget, planDynamicResearchSwarm } from '../src/lib/agent-finance/l1/dynamic-research-swarm';
import type { Foundation } from '../src/lib/agent-finance/l4/foundation';
import { evidenceOutput } from '../src/lib/agent-finance/contracts';
import { selectPrior } from '../src/lib/agent-governance';

function foundation(): Foundation {
  return {
    company: { id: 'security-1', ticker: 'CHIP', sector: 'Semiconductors', currency: 'USD', country: 'US', exchange: 'NASDAQ' },
    fiscalDate: '2026-06-30',
    dataGaps: ['Forward customer concentration evidence is incomplete.'],
    peers: [], estimates: [], documents: [{ id: 'doc-1', title: 'Annual report', type: 'ANNUAL_REPORT', source: 'https://issuer.example/annual', publishedAt: '2026-07-30T00:00:00.000Z', excerpt: 'Demand, inventory, capex and supply chain discussion.' }],
    marketBrief: null, thesisContext: { version: 1 },
  } as unknown as Foundation;
}

describe('dynamic research swarm', () => {
  it('uses bounded complexity budgets and disables the swarm for DCF-only work', () => {
    expect(dynamicResearchBudget('dcf')).toBe(0);
    expect(dynamicResearchBudget('quick')).toBe(3);
    expect(dynamicResearchBudget('fundamental')).toBe(6);
    expect(dynamicResearchBudget('combined')).toBe(8);
  });

  it('falls back to deterministic sector-aware decomposition when the planner model is unavailable', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const plan = await planDynamicResearchSwarm(foundation(), 'fundamental');
    expect(plan.source).toBe('fallback');
    expect(plan.tasks).toHaveLength(6);
    expect(new Set(plan.tasks.map(item => item.id)).size).toBe(plan.tasks.length);
    expect(plan.tasks.some(item => item.label === 'Technology demand and capex cycle')).toBe(true);
    expect(plan.tasks.some(item => item.perspective === 'risk')).toBe(true);
    expect(plan.tasks.every(item => item.objective.length >= 10)).toBe(true);
    vi.unstubAllEnvs();
  });

  it('keeps swarm workers isolated from sibling swarm outputs while exposing validated swarm artifacts to synthesis', () => {
    const output = evidenceOutput({ findings: ['Supported finding'], missingInputs: [] }, ['Retained evidence only.'], ['https://issuer.example/annual']);
    const prior = {
      'financial-statement-analyzer': output,
      'market-industry-research': output,
      'dynamic-research-demand-cycle': output,
      'dynamic-research-supply-chain': output,
      'fundamental-analyst': output,
    };
    const workerContext = selectPrior('dynamic-research-specialist', prior);
    expect(workerContext).toHaveProperty('financial-statement-analyzer');
    expect(workerContext).toHaveProperty('market-industry-research');
    expect(workerContext).not.toHaveProperty('dynamic-research-demand-cycle');
    expect(workerContext).not.toHaveProperty('fundamental-analyst');
    const synthesisContext = selectPrior('fundamental-analyst', prior);
    expect(synthesisContext).toHaveProperty('dynamic-research-demand-cycle');
    expect(synthesisContext).toHaveProperty('dynamic-research-supply-chain');
  });
});
