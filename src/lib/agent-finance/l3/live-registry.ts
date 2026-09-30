import { and, desc, eq, or, isNull, gt } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { agentMemoryEvents } from '@/lib/db/agent-schema';
import { retrieveContext } from '@/lib/document-intelligence/rag/retrieval';
import { discountedCashFlow, type DcfAssumptions } from '@/lib/quant/dcf';
import { ToolRegistry } from './tool-registry';
import {sourceEvidence,type Foundation } from '../l4/foundation';
import { messageSchema,outputSchema } from '../contracts';
import {verifyAgentClaims} from '../l2/model-router';
import { calculateWacc, simulationSchema, sensitivityAnalysis, driverSchema } from '../l4/financial-model';

export function createLiveRegistry(data: Foundation, ownerId: string, sessionId: string): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register('verify_claims',async payload=>{
    const output=outputSchema.parse(payload);
    const evidence=sourceEvidence(data);
    if(process.env.GEMINI_API_KEY && output.claims?.length) {
      const chunks=await retrieveContext(ownerId,data.company.id,output.claims.slice(0,5).map(c=>c.text).join(' '));
      // Retrieved chunks are supplemental evidence from the same owned issuer workspace.
      evidence['retrieved_document_context']=JSON.stringify(chunks);
    }
    return verifyAgentClaims(output,evidence);
  });
  registry.register('fetch_comprehensive_data', async () => data);
  registry.register('fetch_financial_statements', async () => ({ facts: data.facts, sources: data.sources, fiscalDate: data.fiscalDate }));
  registry.register('fetch_price_history', async () => data.prices);
  registry.register('fetch_analyst_estimates', async () => ({ available: data.estimates.length>0, estimates:data.estimates, gaps:data.dataGaps }));
  registry.register('fetch_filings', async () => data.documents.filter(row => row.type !== 'NEWS_ARTICLE'));
  registry.register('fetch_news', async () => data.documents.filter(row => row.type === 'NEWS_ARTICLE'));
  registry.register('fetch_peer_data', async () => ({ available:data.peers.length>0, peers:data.peers, minimumPeers:6 }));
  registry.register('query_documents', async payload => {
    const { query } = z.object({ query: z.string().min(1).max(2000) }).parse(payload);
    return retrieveContext(ownerId, data.company.id, query);
  });
  registry.register('execute_python', async () => { throw new Error('Arbitrary code execution is disabled; use registered deterministic computation tools'); });
  registry.register('run_dcf', async payload => discountedCashFlow(payload as DcfAssumptions));
  registry.register('calculate_wacc', async payload => Object.keys(payload as object).length ? calculateWacc(payload as Parameters<typeof calculateWacc>[0]) : data.wacc);
  registry.register('run_monte_carlo', async payload => {
    const p=z.object({drivers:driverSchema,years:z.number().int().min(5).max(10),wacc:z.number(),terminalGrowth:z.number(),netDebt:z.number(),shares:z.number().positive(),policy:simulationSchema}).parse(payload);
    return sensitivityAnalysis(data.facts,p.drivers,p.years,p.wacc,p.terminalGrowth,p.netDebt,p.shares,p.policy);
  });
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
