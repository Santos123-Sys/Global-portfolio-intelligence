import { and, eq, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentAnalysisSessions, agentDebates } from '@/lib/db/agent-schema';
import { analyzeSchema, dcfAgents, analysisAgents, evidenceOutput, executionPlan } from '../contracts';
import { loadFoundation } from '../l4/foundation';
import { createLiveRegistry } from '../l3/live-registry';
import { ExecutionEngine } from '../l3/execution-engine';
import { dcfAgent } from './dcf-swarm';
import { analysisAgent } from './analysis-swarm';

/** L1: queued PostgreSQL state is authoritative; atomic claim prevents duplicate execution. */
export async function executeSession(sessionId: string): Promise<void> {
  const [session] = await db.update(agentAnalysisSessions).set({ status: 'running', updatedAt: new Date() })
    .where(and(eq(agentAnalysisSessions.id, sessionId), eq(agentAnalysisSessions.status, 'queued'))).returning();
  if (!session) return;
  try {
    const request = analyzeSchema.parse(session.requestPayload);
    const foundation = await loadFoundation(session.ownerId, session.securityId);
    const engine = new ExecutionEngine(session.id, createLiveRegistry(foundation, session.ownerId, session.id));
    await engine.phase('research');
    await engine.run('research-director', async () => {
      await engine.tool('research-director', 'fetch_comprehensive_data');
      await engine.tool('research-director', 'fetch_filings');
      await engine.tool('research-director', 'fetch_news');
      return evidenceOutput({ plan: executionPlan(request.analysisType), ticker: request.ticker }, ['Collect existing dated financial evidence, NewsAdapter-ingested articles and portfolio-linked documents.'], foundation.sources, [], 60);
    });
    if (request.analysisType === 'dcf' || request.analysisType === 'combined') {
      await engine.phase('valuation');
      for (const name of dcfAgents) await engine.run(name, async prior => dcfAgent(name, { request, foundation, outputs: prior }, input => engine.tool(name, 'run_dcf', input)));
    }
    if (request.analysisType !== 'dcf') {
      await engine.phase('analysis');
      await engine.run('analysis-director', prior => analysisAgent('analysis-director', foundation, prior));
      await Promise.all(analysisAgents.slice(1, 6).map(name => engine.run(name, prior => analysisAgent(name, foundation, prior))));
      if (request.analysisType !== 'quick') {
        await Promise.all(['bull-agent', 'bear-agent'].map(name => engine.run(name, prior => analysisAgent(name, foundation, prior))));
        const judge = await engine.run('judge-agent', prior => analysisAgent('judge-agent', foundation, prior));
        await db.insert(agentDebates).values({ sessionId, bullArgument: JSON.stringify(engine.outputs['bull-agent']), bearArgument: JSON.stringify(engine.outputs['bear-agent']), judgeReasoning: judge.reasoningChain.join('\n'), finalScore: judge.data });
      }
    }
    const values = Object.values(engine.outputs);
    const confidenceScore = Math.min(...values.map(row => row.confidenceScore));
    const finalOutput = { ticker: request.ticker, outputs: engine.outputs,
      confidenceScore, reasoningChain: ['Synthesize validated specialist outputs without overwriting conflicting views.', 'Numerical results remain separate from model-written narratives and require human review.'],
      citations: [...new Set(values.flatMap(row => row.citations))], requiresHumanReview: true,
      limitations: [...new Set(values.flatMap(row => row.limitations))],
      status: values.some(row => row.status !== 'completed') ? 'insufficient_data' : 'completed',
    };
    await engine.tool('research-director', 'store_memory', { agentName: 'research-director', eventContent: finalOutput });
    await db.update(agentAnalysisSessions).set({ status: 'completed', phase: 'complete', finalOutput, updatedAt: new Date(), completedAt: new Date() }).where(eq(agentAnalysisSessions.id, sessionId));
  } catch (error) {
    await db.update(agentAnalysisSessions).set({ status: 'failed', error: error instanceof Error ? error.message : 'Analysis failed', updatedAt: new Date(), completedAt: new Date() }).where(eq(agentAnalysisSessions.id, sessionId));
  }
}

export async function processQueuedSessions(): Promise<number> {
  // Never silently leave an interrupted model request "running" indefinitely.
  await db.update(agentAnalysisSessions).set({ status: 'failed', error: 'Execution interrupted or exceeded the ten-minute session lease; start a new run.', completedAt: new Date() }).where(and(eq(agentAnalysisSessions.status, 'running'), lt(agentAnalysisSessions.updatedAt, new Date(Date.now() - 600_000))));
  const queued = await db.select({ id: agentAnalysisSessions.id }).from(agentAnalysisSessions).where(eq(agentAnalysisSessions.status, 'queued')).limit(2);
  for (const row of queued) await executeSession(row.id);
  return queued.length;
}
