import { randomUUID } from 'node:crypto';
import { and, eq, lt, sql,or,isNull,inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentAnalysisSessions, agentDebates, agentRuns } from '@/lib/db/agent-schema';
import { analyzeSchema, dcfAgents, analysisAgents, evidenceOutput, executionPlan, outputSchema } from '../contracts';
import { loadFoundation,sourceEvidence } from '../l4/foundation';
import { acquireExternalResearch } from '../l4/external-research';
import { createLiveRegistry } from '../l3/live-registry';
import { ExecutionEngine } from '../l3/execution-engine';
import { dcfAgent } from './dcf-swarm';
import { analysisAgent } from './analysis-swarm';
import type { Foundation } from '../l4/foundation';
import { recordSessionEvent } from '../l3/session-events';
import { aggregateEquityResearch, researchPlan } from '../equity-research';
import { VALUE_CRITERIA } from '../l4/research-modules';
import { analysisScopes } from '../l3/review';
import { SessionInterrupted } from '../l3/session-control';
import { activeAgentSnapshot, type EffectiveAgentConfig } from '@/lib/agent-governance';
import { processEvaluationQueue } from '@/lib/agent-evaluations';
import { validateQuality } from '../l3/quality';
import { dynamicResearchBudget, planDynamicResearchSwarm, runDynamicResearchSpecialist, summarizeDynamicResearch, type DynamicResearchPlan } from './dynamic-research-swarm';
import { resolveTaskSchedulerOptions, runScheduled } from '../l3/task-scheduler';
import { withModelBudget } from '../l2/model-budget-context';
import { resolveSessionBudgetLimits, SessionBudget, SessionBudgetExceededError, sessionBudgetLimitsSchema } from '../l3/session-budget';
export { initializeFinanceRuntime } from '../startup';

function throwRejected(results: ReadonlyArray<PromiseSettledResult<unknown>>): void {
  const rejected=results.find(result=>result.status==='rejected');
  if(rejected?.status==='rejected') throw rejected.reason;
}

/** L1: queued PostgreSQL state is authoritative; atomic claim prevents duplicate execution. */
export async function executeSession(sessionId: string,onHeartbeat?:()=>void): Promise<void> {
  const token=randomUUID();
  const owned=and(eq(agentAnalysisSessions.id,sessionId),eq(agentAnalysisSessions.leaseOwner,token),eq(agentAnalysisSessions.status,'running'));
  const [session] = await db.update(agentAnalysisSessions).set({ status: 'running',leaseOwner:token,leaseExpiresAt:new Date(Date.now()+120_000),attempts:sql`${agentAnalysisSessions.attempts}+1`, updatedAt: new Date() })
    .where(and(eq(agentAnalysisSessions.id, sessionId), eq(agentAnalysisSessions.status, 'queued'))).returning();
  if (!session) return;
  let lost=false;
  let budget:SessionBudget|null=null;
  const heartbeat=setInterval(()=>{ void db.update(agentAnalysisSessions).set({leaseExpiresAt:new Date(Date.now()+120_000),updatedAt:new Date()}).where(owned).returning({id:agentAnalysisSessions.id}).then(rows=>{if(!rows.length) lost=true;else onHeartbeat?.();}).catch(()=>{lost=true;}); },30_000);
  try {
    const request = analyzeSchema.parse(session.requestPayload);
    const savedLimits=sessionBudgetLimitsSchema.safeParse(session.budgetSnapshot);
    const limits=savedLimits.success?savedLimits.data:resolveSessionBudgetLimits(request.analysisType);
    const sessionBudget=budget=new SessionBudget({limits,usage:{modelCalls:session.modelCalls,inputTokens:session.inputTokens,outputTokens:session.outputTokens,unmeteredModelCalls:session.unmeteredModelCalls,
      estimatedCostUsd:session.estimatedCostUsd===null?null:Number(session.estimatedCostUsd),activeMs:session.budgetActiveMs},persist:async usage=>{
        const rows=await db.update(agentAnalysisSessions).set({modelCalls:usage.modelCalls,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,unmeteredModelCalls:usage.unmeteredModelCalls,
          estimatedCostUsd:usage.estimatedCostUsd===null?null:String(usage.estimatedCostUsd),budgetActiveMs:usage.activeMs,updatedAt:new Date()}).where(owned).returning({id:agentAnalysisSessions.id});
        if(!rows.length)throw new SessionInterrupted();
      }});
    await db.update(agentAnalysisSessions).set({budgetSnapshot:limits,budgetStartedAt:session.budgetStartedAt??new Date()}).where(owned);
    await withModelBudget(sessionBudget,async()=>{
    if(request.portfolioId) {
      const scopes=await analysisScopes(session.ownerId,session.securityId);
      if(!scopes.some(scope=>scope.portfolioId===request.portfolioId && scope.thesisVersionId===request.thesisVersionId)) throw new Error('Linked thesis is no longer active; start a new analysis against the current thesis.');
    }
    const configs=session.configurationSnapshot as Record<string,EffectiveAgentConfig> ?? await activeAgentSnapshot(session.ownerId,session.id);
    await db.update(agentAnalysisSessions).set({configurationSnapshot:configs}).where(owned);

    let foundation=session.evidenceSnapshot as Foundation | null;
    if(!foundation) {
      foundation=await loadFoundation(session.ownerId, session.securityId, request);
      const external=await acquireExternalResearch(foundation,request.analysisType);
      foundation={...foundation,externalResearch:external.evidence,dataGaps:[...foundation.dataGaps,...external.gaps]};
    } else if(!Array.isArray(foundation.externalResearch)) {
      // Backward compatibility for sessions snapshotted before Platform V2.
      foundation={...foundation,externalResearch:[]};
    }
    if(lost) throw new Error('Session lease lost');
    await db.update(agentAnalysisSessions).set({evidenceSnapshot:foundation}).where(owned);
    const engine = new ExecutionEngine(session.id, createLiveRegistry(foundation, session.ownerId, session.id,configs),sourceEvidence(foundation),token,configs);
    const completed=await db.select().from(agentRuns).where(and(eq(agentRuns.sessionId,sessionId),eq(agentRuns.status,'completed')));
    for(const run of completed) if(run.outputPayload) engine.outputs[run.agentName]=run.outputPayload as import('../contracts').AgentOutput;
    await engine.phase('research');
    if(foundation.externalResearch.length) {
      const categories=[...new Set(foundation.externalResearch.map(row=>row.category))];
      await recordSessionEvent(sessionId,{eventType:'finding',summary:`Research Director added ${foundation.externalResearch.length} live evidence source${foundation.externalResearch.length===1?'':'s'} to the session snapshot.`,detail:`Bounded external acquisition completed before specialist analysis. Categories: ${categories.join(', ')}. Search snippets remain evidence leads and are subject to the same citation and claim-verification gates as retained documents.`,agent:'research-director',authority:'notify',consequence:'low',reversible:true});
    }
    await engine.run('research-director', async () => {
      await engine.tool('research-director', 'fetch_comprehensive_data');
      await engine.tool('research-director', 'fetch_filings');
      await engine.tool('research-director', 'fetch_news');
      await engine.tool('research-director', 'fetch_analyst_estimates');
      await engine.tool('research-director', 'fetch_peer_data');
      await engine.tool('research-director', 'calculate_wacc');
      const citations=[...new Set([...foundation.sources,...foundation.externalResearch.map(row=>row.url)])];
      return evidenceOutput({ plan: executionPlan(request.analysisType), ticker: request.ticker,externalEvidence:{count:foundation.externalResearch.length,categories:[...new Set(foundation.externalResearch.map(row=>row.category))]},authority:{...researchPlan(foundation.company,request.analysisType),dynamicResearch:{enabled:request.analysisType!=='dcf',maxParallel:dynamicResearchBudget(request.analysisType)}} }, ['Freeze retained financial evidence and bounded live source discovery into one attributable session snapshot before research decomposition.'], citations, [], 60);
    });
    const financials=await engine.run('financial-statement-analyzer', async () => outputSchema.parse(await engine.tool('financial-statement-analyzer','analyze_financial_statements')));
    if(request.analysisType!=='dcf' && foundation.researchPolicy?.valueScorecard?.enabled && financials.status==='completed' && financials.dataQuality?.status==='review_required' && !foundation.financialReview) {
      await sessionBudget.flush();
      const paused=await db.update(agentAnalysisSessions).set({status:'awaiting_approval',leaseOwner:null,leaseExpiresAt:null,updatedAt:new Date()}).where(owned).returning({id:agentAnalysisSessions.id});
      if(paused.length) await recordSessionEvent(sessionId,{eventType:'approval_required',summary:'Review financial period lengths and source provenance before optional value scoring.',detail:'No timeout implies approval. Missing fields or weak sources will continue to withhold the scorecard total.',authority:'approval_required',consequence:'high',reversible:true});
      throw new SessionInterrupted();
    }
    if(request.analysisType!=='dcf') await engine.run('market-industry-research', async prior => {
      const packet=await engine.tool('market-industry-research','research_market_structure') as Record<string,unknown>;
      return analysisAgent('market-industry-research',foundation,{...prior,'market-research-input':evidenceOutput(packet,['Apply sector-specific industry modules to retained evidence.'],foundation.sources)},configs['market-industry-research']);
    });

    let dynamicPlan:DynamicResearchPlan={version:'dynamic-research-v1',source:'fallback',maxParallel:0,researchAsOf:foundation.fiscalDate,tasks:[]};
    if(request.analysisType!=='dcf') {
      dynamicPlan=await planDynamicResearchSwarm(foundation,request.analysisType,configs['research-director']);
      if(dynamicPlan.tasks.length) {
        const scheduler=resolveTaskSchedulerOptions({concurrency:Math.min(dynamicPlan.maxParallel || 1,resolveTaskSchedulerOptions().concurrency)});
        await recordSessionEvent(sessionId,{eventType:'plan_created',summary:`Research Director created ${dynamicPlan.tasks.length} evidence task${dynamicPlan.tasks.length===1?'':'s'}.`,detail:`Bounded dynamic swarm (${dynamicPlan.source} plan): ${dynamicPlan.tasks.map(item=>item.label).join(' · ')}. Runtime cap ${scheduler.concurrency}; task starts staggered by ${scheduler.staggerMs}ms.`.slice(0,4000),agent:'research-director',authority:'autonomous',consequence:'low',reversible:true});
        const dynamicRuns=await runScheduled(dynamicPlan.tasks.map(item=>()=>engine.run(`dynamic-research-${item.id}`,prior=>runDynamicResearchSpecialist(item,foundation,prior,configs['dynamic-research-specialist']),'dynamic-research-specialist')),{concurrency:scheduler.concurrency,staggerMs:scheduler.staggerMs});
        throwRejected(dynamicRuns);
        const summary=summarizeDynamicResearch(dynamicPlan,engine.outputs);
        await recordSessionEvent(sessionId,{eventType:'finding',summary:`Dynamic research swarm finished ${summary.completed}/${dynamicPlan.tasks.length} tasks.`,detail:`${summary.needsAttention} task${summary.needsAttention===1?'':'s'} need evidence review. Independent subagents do not approve conclusions; their outputs now feed the governed synthesis.`,agent:'research-director',authority:'notify',consequence:summary.needsAttention?'medium':'low',reversible:true});
      }
    }

    if (request.analysisType === 'dcf' || request.analysisType === 'combined') {
      await engine.phase('valuation');
      for (const name of dcfAgents) await engine.run(name, async prior => dcfAgent(name, { request, foundation, outputs: prior }, input => engine.tool(name, 'run_dcf', input)));
    }
    if (request.analysisType !== 'dcf') {
      await engine.phase('analysis');
      await engine.run('analysis-director', prior => analysisAgent('analysis-director', foundation, prior,configs['analysis-director']));
      const specialists=await runScheduled(analysisAgents.slice(1, 6).map(name => () => engine.run(name, prior => analysisAgent(name, foundation, prior,configs[name]))));
      throwRejected(specialists);
      if (request.analysisType !== 'quick') {
        const debate=await runScheduled(['bull-agent', 'bear-agent'].map(name => () => engine.run(name, prior => analysisAgent(name, foundation, prior,configs[name]))),{concurrency:2});
        throwRejected(debate);
        const judge = await engine.run('judge-agent', prior => analysisAgent('judge-agent', foundation, prior,configs['judge-agent']));
        await engine.assertLease();
        await db.insert(agentDebates).values({ sessionId, bullArgument: JSON.stringify(engine.outputs['bull-agent']), bearArgument: JSON.stringify(engine.outputs['bear-agent']), judgeReasoning: judge.reasoningChain.join('\n'), finalScore: judge.data });
      }
    }
    let valueScorecard:unknown={status:'disabled',total:null,requiresHumanReview:true};
    if(request.analysisType!=='dcf' && foundation.researchPolicy?.valueScorecard?.enabled) {
      const scorecard=await engine.run('value-scorecard-analyst',prior=>analysisAgent('value-scorecard-analyst',foundation,{...prior,'scorecard-policy':evidenceOutput({policy:foundation.researchPolicy!.valueScorecard,criteria:VALUE_CRITERIA},['Apply only the approved thesis scoring policy.'],foundation.sources)},configs['value-scorecard-analyst']));
      if(scorecard.status==='completed') valueScorecard=await engine.tool('value-scorecard-analyst','calculate_value_scorecard',{policy:foundation.researchPolicy.valueScorecard,criteria:scorecard.data.criteria,sourceEvidence:sourceEvidence(foundation),dataQuality:engine.outputs['financial-statement-analyzer']?.dataQuality?.status ?? 'insufficient'});
      else valueScorecard={status:'insufficient_data',total:null,requiresHumanReview:true};
    }
    const values = Object.values(engine.outputs);
    // Shadow variants never enter the accepted synthesis; preserve their diagnostics separately.
    for(const name of analysisAgents) {
      const shadow=configs[`${name}:shadow`];if(!shadow || !engine.outputs[name])continue;
      await engine.assertLease();
      const started=Date.now();
      try {
        const result=await analysisAgent(name,foundation,engine.outputs,shadow);
        const errors=validateQuality(result,sourceEvidence(foundation));
        if(result.claims?.length)errors.push(...await engine.tool('quality-validator','verify_claims',result) as string[]);
        if(errors.length)throw new Error('Shadow output failed QA');
        await engine.assertLease();
        await db.insert(agentRuns).values({sessionId:session.id,agentName:`${name}:shadow`,agentRole:name,inputPayload:{configuration:shadow.configurationHash},configurationHash:shadow.configurationHash,outputPayload:result,status:'shadow',confidenceScore:String(result.confidenceScore),executionTimeMs:Date.now()-started,completedAt:new Date()});
      }catch(error){if(error instanceof SessionInterrupted||error instanceof SessionBudgetExceededError)throw error;await engine.assertLease();await db.insert(agentRuns).values({sessionId:session.id,agentName:`${name}:shadow`,agentRole:name,inputPayload:{},configurationHash:shadow.configurationHash,status:'shadow_failed',completedAt:new Date()});}
    }
    const dynamicResearch=summarizeDynamicResearch(dynamicPlan,engine.outputs);
    const coreEntries=Object.entries(engine.outputs).filter(([name])=>!name.startsWith('dynamic-research-'));
    const analytical=coreEntries.filter(([name])=>!['research-director','analysis-director','dcf-orchestrator'].includes(name)).map(([,output])=>output);
    const confidenceScore = analytical.length ? Math.min(...analytical.map(row => row.confidenceScore)) : 0;
    const highPriorityDynamicGap=dynamicResearch.tasks.some(row=>row.priority==='high' && row.output && row.output.status!=='completed');
    const coreValues=coreEntries.map(([,output])=>output);
    await sessionBudget.flush();
    const finalOutput = { ticker: request.ticker, outputs: engine.outputs,
      equityResearch:aggregateEquityResearch(foundation.company,foundation.fiscalDate,request,engine.outputs,foundation.researchLocale ?? foundation.researchPolicy?.locale),dynamicResearch,valueScorecard,
      executionBudget:{limits,usage:sessionBudget.snapshot()},
      confidenceScore, reasoningChain: ['Research Director froze retained and bounded live evidence before decomposing decision-relevant questions.', 'Synthesize validated specialist outputs without overwriting conflicting views.', 'Numerical results remain separate from model-written narratives and require human review.'],
      citations: [...new Set(values.flatMap(row => row.citations))], requiresHumanReview: true,
      limitations: [...new Set(values.flatMap(row => row.limitations))],
      status: confidenceScore<60 || coreValues.some(row => row.status !== 'completed') || highPriorityDynamicGap ? 'insufficient_data' : 'completed',
    };
    await engine.tool('research-director', 'store_memory', { agentName: 'research-director', eventContent: finalOutput });
    if(lost) throw new Error('Session lease lost');
    const finished=await db.update(agentAnalysisSessions).set({ status: 'completed',leaseOwner:null,leaseExpiresAt:null, phase: 'complete', finalOutput, updatedAt: new Date(), completedAt: new Date() }).where(owned).returning({id:agentAnalysisSessions.id});
    if(finished.length) await recordSessionEvent(sessionId,{eventType:'approval_required',summary:'Research finished. Review evidence, conflicts and limitations before accepting.',authority:'approval_required',consequence:'high',reversible:true});
    });
  } catch (error) {
    await budget?.flush().catch(()=>undefined);
    if(error instanceof SessionBudgetExceededError) await recordSessionEvent(sessionId,{eventType:'failed',summary:'Research stopped at its session execution budget.',detail:error.message,agent:'research-director',authority:'notify',consequence:'high',reversible:true});
    await db.update(agentAnalysisSessions).set({ status: 'failed',leaseOwner:null,leaseExpiresAt:null, error: error instanceof Error ? error.message : 'Analysis failed', updatedAt: new Date(), completedAt: new Date() }).where(owned);
  } finally {await budget?.flush().catch(()=>undefined);clearInterval(heartbeat);}
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

export interface ResearchQueueTelemetry {queued:number;running:number;oldestQueuedSeconds:number|null}
export async function getResearchQueueTelemetry(now:number=Date.now()):Promise<ResearchQueueTelemetry> {
  const rows=await db.select({status:agentAnalysisSessions.status,createdAt:agentAnalysisSessions.createdAt}).from(agentAnalysisSessions)
    .where(inArray(agentAnalysisSessions.status,['queued','running'])).limit(1000);
  const queued=rows.filter(row=>row.status==='queued');
  const oldest=queued.reduce<Date|null>((value,row)=>!value||row.createdAt<value?row.createdAt:value,null);
  return {queued:queued.length,running:rows.length-queued.length,oldestQueuedSeconds:oldest===null?null:Math.max(0,Math.round((now-oldest.getTime())/1000))};
}
