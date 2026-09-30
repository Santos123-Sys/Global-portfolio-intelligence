import { and, desc, eq, or, isNull, gt } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { agentMemoryEvents } from '@/lib/db/agent-schema';
import { retrieveContext } from '@/lib/document-intelligence/rag/retrieval';
import { discountedCashFlow, type DcfAssumptions } from '@/lib/quant/dcf';
import { ToolRegistry } from './tool-registry';
import type { Foundation } from '../l4/foundation';
import { messageSchema } from '../contracts';

export function createLiveRegistry(data: Foundation, ownerId: string, sessionId: string): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register('fetch_comprehensive_data', async () => data);
  registry.register('fetch_financial_statements', async () => ({ facts: data.facts, sources: data.sources, fiscalDate: data.fiscalDate }));
  registry.register('fetch_price_history', async () => data.prices);
  registry.register('fetch_analyst_estimates', async () => ({ available: false, reason: 'No canonical analyst estimates adapter is configured' }));
  registry.register('fetch_filings', async () => data.documents.filter(row => row.type !== 'NEWS_ARTICLE'));
  registry.register('fetch_news', async () => data.documents.filter(row => row.type === 'NEWS_ARTICLE'));
  registry.register('fetch_peer_data', async () => ({ available: false, reason: 'Peer comparison must come from the existing verified comparables workflow' }));
  registry.register('query_documents', async payload => {
    const { query } = z.object({ query: z.string().min(1).max(2000) }).parse(payload);
    return retrieveContext(ownerId, data.company.id, query);
  });
  registry.register('execute_python', async () => { throw new Error('Arbitrary code execution is disabled; use registered deterministic computation tools'); });
  registry.register('run_dcf', async payload => discountedCashFlow(payload as DcfAssumptions));
  registry.register('calculate_wacc', async payload => {
    const p = z.object({ riskFreeRate: z.number().min(0).max(.5), beta: z.number().min(0).max(5), equityRiskPremium: z.number().min(0).max(.5), countryRiskPremium: z.number().min(0).max(.5), costOfDebt: z.number().min(0).max(.5), taxRate: z.number().min(0).max(1), debtWeight: z.number().min(0).max(1) }).parse(payload);
    const costOfEquity = p.riskFreeRate + p.beta * p.equityRiskPremium + p.countryRiskPremium;
    return { costOfEquity, wacc: costOfEquity * (1 - p.debtWeight) + p.costOfDebt * (1 - p.taxRate) * p.debtWeight };
  });
  registry.register('run_monte_carlo', async () => ({ available: false, reason: 'Reviewed probability distributions required; sensitivity scenarios are not Monte Carlo samples' }));
  registry.register('retrieve_memory', async () => db.select().from(agentMemoryEvents).where(and(eq(agentMemoryEvents.ownerId, ownerId), eq(agentMemoryEvents.securityId, data.company.id), or(isNull(agentMemoryEvents.expiresAt), gt(agentMemoryEvents.expiresAt, new Date())))).orderBy(desc(agentMemoryEvents.createdAt)).limit(20));
  registry.register('store_memory', async payload => {
    const content = z.object({ agentName: z.string().min(1).max(50), eventContent: z.record(z.unknown()) }).parse(payload);
    await db.insert(agentMemoryEvents).values({ ...content, ownerId, securityId: data.company.id, memoryType: 'working', eventType: 'agent_output', expiresAt: new Date(Date.now() + 3600_000) });
    return { stored: true };
  });
  registry.register('deliver_message', async payload => {
    const message = messageSchema.parse(payload);
    if (message.sessionId !== sessionId) throw new Error('Cross-session agent message rejected');
    return message;
  });
  return registry;
}
