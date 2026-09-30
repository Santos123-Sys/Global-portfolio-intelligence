import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentAnalysisSessions, agentRuns } from '@/lib/db/agent-schema';
import { outputSchema, type AgentOutput, type AgentMessage } from '../contracts';
import { ToolRegistry, type ToolName } from './tool-registry';

export class ExecutionEngine {
  readonly outputs: Record<string, AgentOutput> = {};
  constructor(readonly sessionId: string, readonly registry: ToolRegistry) {}
  async tool(agent: string, name: ToolName, payload: unknown = {}): Promise<unknown> {
    return this.registry.invoke(name, { from: agent, to: name, messageType: 'request', payload, timestamp: new Date().toISOString(), sessionId: this.sessionId });
  }
  async phase(phase: 'research' | 'analysis' | 'valuation') {
    await db.update(agentAnalysisSessions).set({ phase, updatedAt: new Date() }).where(and(eq(agentAnalysisSessions.id, this.sessionId), eq(agentAnalysisSessions.status, 'running')));
  }
  async run(name: string, handler: (prior: Record<string, AgentOutput>) => Promise<AgentOutput>): Promise<AgentOutput> {
    const start = Date.now();
    const [run] = await db.insert(agentRuns).values({ sessionId: this.sessionId, agentName: name, agentRole: name, inputPayload: this.outputs }).returning({ id: agentRuns.id });
    try {
      const incoming = await this.tool('research-director', 'deliver_message', {
        from: 'research-director', to: name, messageType: 'request', payload: this.outputs,
        timestamp: new Date().toISOString(), sessionId: this.sessionId,
      }) as AgentMessage;
      const output = outputSchema.parse(await handler(incoming.payload as Record<string, AgentOutput>));
      const message: AgentMessage = { from: name, to: 'research-director', messageType: 'response', payload: output, timestamp: new Date().toISOString(), sessionId: this.sessionId };
      await this.tool(name, 'deliver_message', message);
      this.outputs[name] = output;
      await db.update(agentRuns).set({ outputPayload: output, reasoningChain: JSON.stringify(output.reasoningChain), confidenceScore: String(output.confidenceScore), executionTimeMs: Date.now() - start, status: output.status, completedAt: new Date() }).where(eq(agentRuns.id, run.id));
      await db.update(agentAnalysisSessions).set({ updatedAt: new Date() }).where(eq(agentAnalysisSessions.id, this.sessionId));
      return output;
    } catch (error) {
      const output = outputSchema.parse({ status: 'blocked', data: {}, reasoningChain: ['Agent execution did not produce a validated evidence-backed result.'], confidenceScore: 0, citations: [], limitations: [error instanceof Error ? error.message : 'Agent failed'] });
      this.outputs[name] = output;
      await db.update(agentRuns).set({ status: 'failed', outputPayload: output, reasoningChain: JSON.stringify(output.reasoningChain), confidenceScore: '0', completedAt: new Date(), executionTimeMs: Date.now() - start }).where(eq(agentRuns.id, run.id));
      return output;
    }
  }
}
