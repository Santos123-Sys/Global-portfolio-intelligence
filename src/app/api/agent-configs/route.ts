import { after,NextResponse } from 'next/server';
import { and,desc,eq,sql } from 'drizzle-orm';
import { z } from 'zod';
import { AGENT_REGISTRY,AgentKind,AGENT_REASONING_PROMPTS,GOVERNANCE_VERSION,DETERMINISTIC_ENGINE_POLICIES,evaluateConfiguration,runtimePolicySchema } from '@portfolio-intelligence/agentic-contract';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { effectiveConfig } from '@/lib/agent-governance';
import { confidenceReviewSummary } from '@/lib/agent-confidence';
import { processEvaluationQueue } from '@/lib/agent-evaluations';
import { db } from '@/lib/db';
import { agentConfigurations } from '@/lib/db/workflow-schema';
import { agentAnalysisSessions,agentRuns,agentToolTraces,agentEvaluationJobs } from '@/lib/db/agent-schema';

export const runtime='nodejs';
const mutation=z.object({action:z.enum(['save','evaluate','promote','rollback']).default('save'),agentKind:z.string().refine(id=>AGENT_REGISTRY.some(a=>a.id===id),'Unknown agent'),version:z.number().int().positive().optional(),rollout:z.enum(['production','canary','shadow']).default('production'),name:z.string().trim().min(1).max(120).optional(),scope:z.string().trim().min(1).max(2000).optional(),promptAddendum:z.string().trim().max(4000).optional(),enabledTools:z.array(z.string()).max(16).optional(),runtimePolicy:runtimePolicySchema.optional()}).strict();
async function rowsFor(ownerId:string){return db.select().from(agentConfigurations).where(eq(agentConfigurations.ownerId,ownerId)).orderBy(desc(agentConfigurations.versionNumber));}
export async function GET(req:Request) {
  const session=await authenticateRequest(req);if(!session.ok)return session.response;
  if(!session.auth.isPlatformAdmin)return NextResponse.json({error:'Administrator access required'},{status:403});
  const rows=await rowsFor(session.auth.userId);
  const configurations=AGENT_REGISTRY.map(definition=>{
    const versions=rows.filter(r=>r.agentKind===definition.id),active=versions.find(r=>r.active && r.rolloutState==='production');
    const config=effectiveConfig(definition.id,active),legacy=AgentKind.safeParse(definition.id);
    return {...config,...definition,allowedTools:definition.tools,reasoningPromptVersion:GOVERNANCE_VERSION,reasoningPrompt:legacy.success ? AGENT_REASONING_PROMPTS[legacy.data] : {sourceFile:null,adaptationNote:'Protected registry policy; deterministic agents do not execute prompt text.',systemPrompt:config.protectedPolicy},versions:versions.map(r=>({...effectiveConfig(r.agentKind,r),active:r.active,rolloutState:r.rolloutState,evaluation:r.evaluation,createdAt:r.createdAt}))};
  });
  const runs=await db.select({run:agentRuns}).from(agentRuns).innerJoin(agentAnalysisSessions,eq(agentRuns.sessionId,agentAnalysisSessions.id)).where(eq(agentAnalysisSessions.ownerId,session.auth.userId)).orderBy(desc(agentRuns.startedAt)).limit(50);
  const traces=await db.select({trace:agentToolTraces}).from(agentToolTraces).innerJoin(agentAnalysisSessions,eq(agentToolTraces.sessionId,agentAnalysisSessions.id)).where(eq(agentAnalysisSessions.ownerId,session.auth.userId)).orderBy(desc(agentToolTraces.createdAt)).limit(100);
  const reviews=await db.select({finalOutput:agentAnalysisSessions.finalOutput,accuracyScore:agentAnalysisSessions.accuracyScore}).from(agentAnalysisSessions).where(and(eq(agentAnalysisSessions.ownerId,session.auth.userId),eq(agentAnalysisSessions.status,'completed'))).orderBy(desc(agentAnalysisSessions.completedAt)).limit(500);
  return NextResponse.json({configurations,runs:runs.map(r=>r.run),traces:traces.map(r=>r.trace),confidenceReviews:confidenceReviewSummary(reviews),immutablePolicy:'Unified registry: protected instructions, immutable configuration snapshots and enforced tool allowlists. New settings apply on the next run; in-flight runs keep their snapshot.',deterministicEnginePolicies:DETERMINISTIC_ENGINE_POLICIES},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:Request) {
  const session=await authenticateRequest(req);if(!session.ok)return session.response;
  if(!session.auth.isPlatformAdmin)return NextResponse.json({error:'Administrator access required'},{status:403});
  try{assertSameOrigin(req);}catch{return NextResponse.json({error:'Cross-origin mutation rejected'},{status:403});}
  const parsed=mutation.safeParse(await req.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({error:parsed.error.flatten()},{status:400});
  const input=parsed.data,ownerId=session.auth.userId;
  try {
    if(input.action==='evaluate') {
      const rows=await rowsFor(ownerId),target=rows.find(r=>r.agentKind===input.agentKind && r.versionNumber===input.version);
      if(!target || target.active)throw new Error('Select an inactive draft for evaluation');
      const baseline=effectiveConfig(input.agentKind,rows.find(r=>r.agentKind===input.agentKind && r.active && r.rolloutState==='production')),config=effectiveConfig(input.agentKind,target);
      const safety=evaluateConfiguration(input.agentKind,config.scope,config.promptAddendum,config.enabledTools);
      if(!safety.passed)throw new Error('Configuration safety checks failed');
      if(AGENT_REGISTRY.find(a=>a.id===input.agentKind)?.execution==='deterministic') {
        await db.update(agentConfigurations).set({evaluation:{...safety,configurationHash:config.configurationHash,deterministic:true}}).where(eq(agentConfigurations.id,target.id));
        return NextResponse.json({message:'Deterministic policy checks passed; no model prompt executed.'});
      }
      await db.transaction(async tx=>{
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ownerId+':'+input.agentKind}))`);
        const jobs=await tx.select().from(agentEvaluationJobs).where(eq(agentEvaluationJobs.configurationId,target.id));
        if(jobs.some(j=>j.status==='queued'||j.status==='running'))throw new Error('An evaluation is already queued or running for this version');
        await tx.insert(agentEvaluationJobs).values({ownerId,configurationId:target.id,candidate:config,baseline});
        await tx.update(agentConfigurations).set({evaluation:{kind:'running',completed:0,total:30,configurationHash:config.configurationHash}}).where(eq(agentConfigurations.id,target.id));
      });
      if(process.env.OPENAI_API_KEY)after(async()=>{await processEvaluationQueue();});
      return NextResponse.json({message:'Evaluation queued: 30 baseline and 30 candidate synthetic cases plus verification. The existing finance worker/cron processes durable checkpoints. This incurs model usage; refresh for progress.'},{status:202});
    }
    const result=await db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ownerId+':'+input.agentKind}))`);
      const rows=await tx.select().from(agentConfigurations).where(and(eq(agentConfigurations.ownerId,ownerId),eq(agentConfigurations.agentKind,input.agentKind))).orderBy(desc(agentConfigurations.versionNumber));
      if(input.action==='save') {
        if(!input.name || !input.scope || input.promptAddendum===undefined || !input.enabledTools)throw new Error('Complete all configuration fields');
        const safety=evaluateConfiguration(input.agentKind,input.scope,input.promptAddendum,input.enabledTools);if(!safety.passed)throw new Error('Protected policy or tool safety check failed');
        if(AgentKind.safeParse(input.agentKind).success && input.runtimePolicy?.fallbackModel)throw new Error('Legacy worker stages do not support model fallback; leave it unset');
        const [row]=await tx.insert(agentConfigurations).values({ownerId,agentKind:input.agentKind,versionNumber:(rows[0]?.versionNumber ?? 0)+1,name:input.name,scope:input.scope,promptAddendum:input.promptAddendum,enabledTools:input.enabledTools,runtimePolicy:input.runtimePolicy ?? runtimePolicySchema.parse({}),active:false,rolloutState:'draft',evaluation:safety}).returning();return row;
      }
      const target=rows.find(r=>r.versionNumber===input.version);if(!target)throw new Error('Version not found');
      const config=effectiveConfig(input.agentKind,target),evaluation=target.evaluation as {passed?:boolean;configurationHash?:string;baselineHash?:string}|null;
      if(!evaluation?.passed || evaluation.configurationHash!==config.configurationHash)throw new Error('Pass evaluation for this exact configuration before activation or rollback');
      if(input.action==='promote' && evaluation.baselineHash && evaluation.baselineHash!==effectiveConfig(input.agentKind,rows.find(r=>r.active&&r.rolloutState==='production')).configurationHash)throw new Error('Production baseline changed; reevaluate this candidate before promotion');
      if(input.action==='rollback' && target.rolloutState==='draft')throw new Error('Rollback requires a previously deployed version');
      const definition=AGENT_REGISTRY.find(a=>a.id===input.agentKind)!;
      if(input.rollout!=='production' && (definition.layer!=='Analysis Swarm'||definition.execution!=='model'))throw new Error('Shadow/canary is available only for Analysis Swarm model agents');
      await tx.update(agentConfigurations).set({active:false}).where(and(eq(agentConfigurations.ownerId,ownerId),eq(agentConfigurations.agentKind,input.agentKind),eq(agentConfigurations.rolloutState,input.rollout)));
      const [row]=await tx.update(agentConfigurations).set({active:true,rolloutState:input.rollout}).where(eq(agentConfigurations.id,target.id)).returning();return row;
    });
    return NextResponse.json({configuration:result,message:input.action==='save' ? 'Draft saved. Evaluate before activation.' : 'Version activated for new runs.'},{status:201});
  }catch(error){return NextResponse.json({error:error instanceof Error ? error.message : 'Configuration operation failed'},{status:400});}
}
