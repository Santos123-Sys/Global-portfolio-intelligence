import { randomUUID } from 'node:crypto';
import { and, eq, lt, sql,or,isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentAnalysisSessions, agentDebates, agentRuns } from '@/lib/db/agent-schema';
import { analyzeSchema, dcfAgents, analysisAgents, evidenceOutput, executionPlan } from '../contracts';
import { loadFoundation,sourceEvidence } from '../l4/foundation';
import { createLiveRegistry } from '../l3/live-registry';
import { ExecutionEngine } from '../l3/execution-engine';
import { dcfAgent } from './dcf-swarm';
import { analysisAgent } from './analysis-swarm';
import type { Foundation } from '../l4/foundation';
import { activeAgentSnapshot, type EffectiveAgentConfig } from '@/lib/agent-governance';
import { processEvaluationQueue } from '@/lib/agent-evaluations';
import { validateQuality } from '../l3/quality';

/** L1: queued PostgreSQL state is authoritative; atomic claim prevents duplicate execution. */
export async function executeSession(sessionId: string,onHeartbeat?:()=>void): Promise<void> {
  const token=randomUUID();
  const owned=and(eq(agentAnalysisSessions.id,sessionId),eq(agentAnalysisSessions.leaseOwner,token),eq(agentAnalysisSessions.status,'running'));
  const [session] = await db.update(agentAnalysisSessions).set({ status: 'running',leaseOwner:token,leaseExpiresAt:new Date(Date.now()+120_000),attempts:sql`${agentAnalysisSessions.attempts}+1`, updatedAt: new Date() })
    .where(and(eq(agentAnalysisSessions.id, sessionId), eq(agentAnalysisSessions.status, 'queued'))).returning();
  if (!session) return;
  let lost=false;
  const heartbeat=setInterval(()=>{ void db.update(agentAnalysisSessions).set({leaseExpiresAt:new Date(Date.now()+120_000),updatedAt:new Date()}).where(owned).returning({id:agentAnalysisSessions.id}).then(rows=>{if(!rows.length) lost=true;else onHeartbeat?.();}).catch(()=>{lost=true;}); },30_000);
  try {
    const request = analyzeSchema.parse(session.requestPayload);
    const configs=session.configurationSnapshot as Record<string,EffectiveAgentConfig> ?? await activeAgentSnapshot(session.ownerId,session.id);
    await db.update(agentAnalysisSessions).set({configurationSnapshot:configs}).where(owned);
    const foundation = session.evidenceSnapshot as Foundation ?? await loadFoundation(session.ownerId, session.securityId, request);
    if(lost) throw new Error('Session lease lost');
    await db.update(agentAnalysisSessions).set({evidenceSnapshot:foundation}).where(owned);
    const engine = new ExecutionEngine(session.id, createLiveRegistry(foundation, session.ownerId, session.id,configs),sourceEvidence(foundation),token,configs);
    const completed=await db.select().from(agentRuns).where(and(eq(agentRuns.sessionId,sessionId),eq(agentRuns.status,'completed')));
    for(const run of completed) if(run.outputPayload) engine.outputs[run.agentName]=run.outputPayload as import('../contracts').AgentOutput;
    await engine.phase('research');
    await engine.run('research-director', async () => {
      await engine.tool('research-director', 'fetch_comprehensive_data');
      await engine.tool('research-director', 'fetch_filings');
      await engine.tool('research-director', 'fetch_news');
      await engine.tool('research-director', 'fetch_analyst_estimates');
      await engine.tool('research-director', 'fetch_peer_data');
      await engine.tool('research-director', 'calculate_wacc');
      return evidenceOutput({ plan: executionPlan(request.analysisType), ticker: request.ticker }, ['Collect existing dated financial evidence, NewsAdapter-ingested articles and portfolio-linked documents.'], foundation.sources, [], 60);
    });
    if (request.analysisType === 'dcf' || request.analysisType === 'combined') {
      await engine.phase('valuation');
      for (const name of dcfAgents) await engine.run(name, async prior => dcfAgent(name, { request, foundation, outputs: prior }, input => engine.tool(name, 'run_dcf', input)));
    }
    if (request.analysisType !== 'dcf') {
      await engine.phase('analysis');
      await engine.run('analysis-director', prior => analysisAgent('analysis-director', foundation, prior,configs['analysis-director']));
      await Promise.all(analysisAgents.slice(1, 6).map(name => engine.run(name, prior => analysisAgent(name, foundation, prior,configs[name]))));
      if (request.analysisType !== 'quick') {
        await Promise.all(['bull-agent', 'bear-agent'].map(name => engine.run(name, prior => analysisAgent(name, foundation, prior,configs[name]))));
        const judge = await engine.run('judge-agent', prior => analysisAgent('judge-agent', foundation, prior,configs['judge-agent']));
        await db.insert(agentDebates).values({ sessionId, bullArgument: JSON.stringify(engine.outputs['bull-agent']), bearArgument: JSON.stringify(engine.outputs['bear-agent']), judgeReasoning: judge.reasoningChain.join('\n'), finalScore: judge.data });
      }
    }
    const values = Object.values(engine.outputs);
    // Shadow variants never enter the accepted synthesis; preserve their diagnostics separately.
    for(const name of analysisAgents) {
      const shadow=configs[`${name}:shadow`];if(!shadow || !engine.outputs[name])continue;
      const started=Date.now();
      try {
        const result=await analysisAgent(name,foundation,engine.outputs,shadow);
        const errors=validateQuality(result,sourceEvidence(foundation));
        if(result.claims?.length)errors.push(...await engine.tool('quality-validator','verify_claims',result) as string[]);
        if(errors.length)throw new Error('Shadow output failed QA');
        await db.insert(agentRuns).values({sessionId:session.id,agentName:`${name}:shadow`,agentRole:name,inputPayload:{configuration:shadow.configurationHash},configurationHash:shadow.configurationHash,outputPayload:result,status:'shadow',confidenceScore:String(result.confidenceScore),executionTimeMs:Date.now()-started,completedAt:new Date()});
      }catch{await db.insert(agentRuns).values({sessionId:session.id,agentName:`${name}:shadow`,agentRole:name,inputPayload:{},configurationHash:shadow.configurationHash,status:'shadow_failed',completedAt:new Date()});}
    }
    const analytical=Object.entries(engine.outputs).filter(([name])=>!['research-director','analysis-director','dcf-orchestrator'].includes(name)).map(([,output])=>output);
    const confidenceScore = analytical.length ? Math.min(...analytical.map(row => row.confidenceScore)) : 0;
    const finalOutput = { ticker: request.ticker, outputs: engine.outputs,
      confidenceScore, reasoningChain: ['Synthesize validated specialist outputs without overwriting conflicting views.', 'Numerical results remain separate from model-written narratives and require human review.'],
      citations: [...new Set(values.flatMap(row => row.citations))], requiresHumanReview: true,
      limitations: [...new Set(values.flatMap(row => row.limitations))],
      status: confidenceScore<60 || values.some(row => row.status !== 'completed') ? 'insufficient_data' : 'completed',
    };
    await engine.tool('research-director', 'store_memory', { agentName: 'research-director', eventContent: finalOutput });
    if(lost) throw new Error('Session lease lost');
    await db.update(agentAnalysisSessions).set({ status: 'completed',leaseOwner:null,leaseExpiresAt:null, phase: 'complete', finalOutput, updatedAt: new Date(), completedAt: new Date() }).where(owned);
  } catch (error) {
    await db.update(agentAnalysisSessions).set({ status: 'failed',leaseOwner:null,leaseExpiresAt:null, error: error instanceof Error ? error.message : 'Analysis failed', updatedAt: new Date(), completedAt: new Date() }).where(owned);
  } finally {clearInterval(heartbeat);}
}

export async function processQueuedSessions(onHeartbeat?:()=>void): Promise<number> {
  const evaluated=await processEvaluationQueue(onHeartbeat);
  // Never silently leave an interrupted model request "running" indefinitely.
  const expired=or(isNull(agentAnalysisSessions.leaseExpiresAt),lt(agentAnalysisSessions.leaseExpiresAt,new Date()));
  await db.update(agentAnalysisSessions).set({status:'failed',error:'Worker interrupted three times; inspect run history before retrying.',leaseOwner:null,leaseExpiresAt:null,completedAt:new Date()}).where(and(eq(agentAnalysisSessions.status,'running'),expired,sql`${agentAnalysisSessions.attempts}>=3`));
  await db.update(agentAnalysisSessions).set({status:'queued',leaseOwner:null,leaseExpiresAt:null,updatedAt:new Date()}).where(and(eq(agentAnalysisSessions.status,'running'),expired,sql`${agentAnalysisSessions.attempts}<3`));
  const queued = await db.select({ id: agentAnalysisSessions.id }).from(agentAnalysisSessions).where(eq(agentAnalysisSessions.status, 'queued')).limit(1);
  for (const row of queued) await executeSession(row.id,onHeartbeat);
  return queued.length+evaluated;
}
