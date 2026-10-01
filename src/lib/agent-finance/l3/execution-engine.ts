import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentAnalysisSessions, agentRuns } from '@/lib/db/agent-schema';
import { outputSchema, type AgentOutput, type AgentMessage } from '../contracts';
import { ToolRegistry, type ToolName } from './tool-registry';
import { validateQuality } from './quality';
import { SessionInterrupted } from './session-control';
import { recordSessionEvent } from './session-events';
import { selectPrior, type EffectiveAgentConfig } from '@/lib/agent-governance';

export class ExecutionEngine {
  readonly outputs: Record<string, AgentOutput> = {};
  constructor(readonly sessionId: string, readonly registry: ToolRegistry, readonly sources:Record<string,string>={}, readonly leaseOwner?:string,readonly configs:Record<string,EffectiveAgentConfig>={}) {}
  async assertLease() {
    if(!this.leaseOwner) return;
    const [row]=await db.select({id:agentAnalysisSessions.id}).from(agentAnalysisSessions).where(and(eq(agentAnalysisSessions.id,this.sessionId),eq(agentAnalysisSessions.leaseOwner,this.leaseOwner),eq(agentAnalysisSessions.status,'running')));
    if(!row) throw new SessionInterrupted();
  }
  private runFence(runId:string) {
    return and(eq(agentRuns.id,runId),eq(agentRuns.status,'running'),this.leaseOwner ? sql`exists (select 1 from agent_analysis_sessions where id = ${this.sessionId} and lease_owner = ${this.leaseOwner} and status = 'running')` : undefined);
  }
  async tool(agent: string, name: ToolName, payload: unknown = {}): Promise<unknown> {
    await this.assertLease();
    return this.registry.invoke(name, { from: agent, to: name, messageType: 'request', payload, timestamp: new Date().toISOString(), sessionId: this.sessionId });
  }
  async phase(phase: 'research' | 'analysis' | 'valuation') {
    await this.assertLease();
    const rows=await db.update(agentAnalysisSessions).set({ phase, updatedAt: new Date() }).where(and(eq(agentAnalysisSessions.id, this.sessionId), eq(agentAnalysisSessions.status, 'running'),this.leaseOwner ? eq(agentAnalysisSessions.leaseOwner,this.leaseOwner) : undefined)).returning({id:agentAnalysisSessions.id});
    if(this.leaseOwner && !rows.length) throw new SessionInterrupted();
    await recordSessionEvent(this.sessionId,{eventType:'phase_started',summary:`Started ${phase} phase.`,authority:'autonomous',consequence:'low',reversible:true});
  }
  async run(name: string, handler: (prior: Record<string, AgentOutput>) => Promise<AgentOutput>): Promise<AgentOutput> {
    await this.assertLease();
    if(this.outputs[name]?.status==='completed') return this.outputs[name];
    const start = Date.now();
    const inputs=selectPrior(name,this.outputs);
    const [run] = await db.insert(agentRuns).values({ sessionId: this.sessionId, agentName: name, agentRole: name, inputPayload: inputs,configurationHash:this.configs[name]?.configurationHash }).returning({ id: agentRuns.id });
    await recordSessionEvent(this.sessionId,{eventType:'tool_started',summary:`Started ${name.replaceAll('-',' ')}.`,agent:name,authority:'autonomous',consequence:'low',reversible:true});
    try {
      const incoming = await this.tool('research-director', 'deliver_message', {
        from: 'research-director', to: name, messageType: 'request', payload: inputs,
        timestamp: new Date().toISOString(), sessionId: this.sessionId,
      }) as AgentMessage;
      let output:AgentOutput | undefined;
      let errors:string[]=[];
      for(let attempt=0;attempt<(this.configs[name]?.runtimePolicy.maxAttempts ?? 3);attempt++) {
        const prior=incoming.payload as Record<string,AgentOutput>;
        const feedback:AgentOutput={status:'blocked',data:{attempt,errors},reasoningChain:['Correct failed QA checks; retain missing evidence as insufficient data.'],confidenceScore:0,citations:[],limitations:errors};
        try {
          output=outputSchema.parse(await handler(errors.length ? {...prior,'qa-feedback':feedback} : prior));
          errors=validateQuality(output,this.sources);
          if(!errors.length && output.claims?.length) errors=await this.tool('quality-validator','verify_claims',output) as string[];
        } catch(error) { if(error instanceof SessionInterrupted)throw error;errors=[error instanceof Error ? error.message : 'Invalid output']; }
        if(!errors.length && output) break;
        await this.tool('quality-validator','deliver_message',{from:'quality-validator',to:name,messageType:'feedback',payload:{attempt:attempt+1,errors},timestamp:new Date().toISOString(),sessionId:this.sessionId});
      }
      if(!output || errors.length) throw new Error(`QA rejected output after ${this.configs[name]?.runtimePolicy.maxAttempts ?? 3} attempts: ${errors.join('; ')}`);
      await this.assertLease();
      const message: AgentMessage = { from: name, to: 'research-director', messageType: 'response', payload: output, timestamp: new Date().toISOString(), sessionId: this.sessionId };
      await this.tool(name, 'deliver_message', message);
      const saved=await db.update(agentRuns).set({ outputPayload: output, reasoningChain: JSON.stringify(output.reasoningChain), confidenceScore: String(output.confidenceScore), executionTimeMs: Date.now() - start, status: output.status, completedAt: new Date() }).where(this.runFence(run.id)).returning({id:agentRuns.id});
      if(this.leaseOwner && !saved.length) throw new SessionInterrupted();
      this.outputs[name] = output;
      await recordSessionEvent(this.sessionId,{eventType:output.status==='completed'?'tool_completed':'warning',summary:`${name.replaceAll('-',' ')} ${output.status==='completed'?'completed':'needs evidence review'}.`,detail:output.limitations.slice(0,4).join(' '),agent:name,authority:'autonomous',consequence:'low',reversible:true});
      return output;
    } catch (error) {
      if(error instanceof SessionInterrupted) throw error;
      await this.assertLease();
      const output = outputSchema.parse({ status: 'blocked', data: {}, reasoningChain: ['Agent execution did not produce a validated evidence-backed result.'], confidenceScore: 0, citations: [], limitations: [error instanceof Error ? error.message : 'Agent failed'] });
      const saved=await db.update(agentRuns).set({ status: 'failed', outputPayload: output, reasoningChain: JSON.stringify(output.reasoningChain), confidenceScore: '0', completedAt: new Date(), executionTimeMs: Date.now() - start }).where(this.runFence(run.id)).returning({id:agentRuns.id});
      if(this.leaseOwner && !saved.length) throw new SessionInterrupted();
      this.outputs[name] = output;
      await recordSessionEvent(this.sessionId,{eventType:'failed',summary:`${name.replaceAll('-',' ')} failed validation.`,detail:output.limitations.join('; ').slice(0,4000),agent:name,authority:'notify',consequence:'medium',reversible:true});
      return output;
    }
  }
}
