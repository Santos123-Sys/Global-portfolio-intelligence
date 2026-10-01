import { messageSchema, type AgentMessage } from '../contracts';
import { agentDefinition } from '@portfolio-intelligence/agentic-contract';
import type { EffectiveAgentConfig } from '@/lib/agent-governance';

export interface ToolTrace {agentName:string;toolName:string;configurationHash:string|null;status:string;latencyMs:number;errorCode:string|null}

export const TOOL_NAMES = ['fetch_financial_statements', 'fetch_price_history', 'fetch_analyst_estimates',
  'fetch_comprehensive_data', 'query_documents', 'fetch_filings', 'execute_python', 'calculate_wacc',
  'run_monte_carlo', 'fetch_news', 'fetch_peer_data', 'retrieve_memory', 'store_memory', 'run_dcf', 'deliver_message','verify_claims'] as const;
export type ToolName = typeof TOOL_NAMES[number];
type Handler = (input: unknown, message: AgentMessage) => Promise<unknown>;

/** L3: the sole data/compute/message gateway. JSON round trips prevent shared mutable agent state. */
export class ToolRegistry {
  private readonly tools = new Map<ToolName, Handler>();
  readonly messages: AgentMessage[] = [];
  private readonly calls=new Map<string,number>();
  constructor(private readonly policy?:{sessionId:string;configs:Record<string,EffectiveAgentConfig>;trace:(event:ToolTrace)=>Promise<void>}) {}
  register(name: ToolName, handler: Handler): this {
    if (this.tools.has(name)) throw new Error(`Tool already registered: ${name}`);
    this.tools.set(name, handler); return this;
  }
  async invoke(name: ToolName, envelope: AgentMessage): Promise<unknown> {
    const request = messageSchema.parse(JSON.parse(JSON.stringify(envelope)));
    if (request.messageType !== 'request') throw new Error('Tool calls require request messages');
    const start=Date.now();
    const config=this.policy?.configs[request.from];
    try {
    const definition=agentDefinition(request.from);
    if(request.to!==name || (this.policy && request.sessionId!==this.policy.sessionId)) throw new Error('tool_scope_denied');
    if(this.policy && !config) throw new Error('agent_configuration_missing');
    if(config && (config.agentKind!==request.from || config.enabledTools.some(tool=>!definition.tools.includes(tool))))throw new Error('tool_configuration_invalid');
    if(!(config?.enabledTools ?? definition.tools).includes(name)) throw new Error('tool_policy_denied');
    const count=(this.calls.get(request.from) ?? 0)+1;
    this.calls.set(request.from,count);
    if(count>(config?.runtimePolicy.maxToolCalls ?? 100)) throw new Error('tool_budget_exceeded');
    const tool = this.tools.get(name); if (!tool) throw new Error(`Tool unavailable: ${name}`);
    this.messages.push(request);
    const value = await tool(request.payload, request);
    const result = JSON.parse(JSON.stringify(value ?? null)) as unknown;
    this.messages.push({ ...request, from: name, to: request.from, messageType: 'response', payload: result, timestamp: new Date().toISOString() });
    await this.policy?.trace({agentName:request.from,toolName:name,configurationHash:config?.configurationHash ?? null,status:'completed',latencyMs:Date.now()-start,errorCode:null});
    return result;
    } catch(error) {
      await this.policy?.trace({agentName:request.from,toolName:name,configurationHash:config?.configurationHash ?? null,status:'failed',latencyMs:Date.now()-start,errorCode:error instanceof Error && /^(tool_|agent_)/.test(error.message) ? error.message : 'tool_execution_failed'});
      throw error;
    }
  }
}

export function createMockRegistry(fixtures: Partial<Record<ToolName, unknown>>): ToolRegistry {
  const registry = new ToolRegistry();
  for (const name of TOOL_NAMES) registry.register(name, async () => {
    if (!(name in fixtures)) throw new Error(`Mock fixture missing: ${name}`);
    return fixtures[name];
  });
  return registry;
}
