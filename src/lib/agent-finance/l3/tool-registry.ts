import { messageSchema, type AgentMessage } from '../contracts';

export const TOOL_NAMES = ['fetch_financial_statements', 'fetch_price_history', 'fetch_analyst_estimates',
  'fetch_comprehensive_data', 'query_documents', 'fetch_filings', 'execute_python', 'calculate_wacc',
  'run_monte_carlo', 'fetch_news', 'fetch_peer_data', 'retrieve_memory', 'store_memory', 'run_dcf', 'deliver_message'] as const;
export type ToolName = typeof TOOL_NAMES[number];
type Handler = (input: unknown, message: AgentMessage) => Promise<unknown>;

/** L3: the sole data/compute/message gateway. JSON round trips prevent shared mutable agent state. */
export class ToolRegistry {
  private readonly tools = new Map<ToolName, Handler>();
  readonly messages: AgentMessage[] = [];
  register(name: ToolName, handler: Handler): this {
    if (this.tools.has(name)) throw new Error(`Tool already registered: ${name}`);
    this.tools.set(name, handler); return this;
  }
  async invoke(name: ToolName, envelope: AgentMessage): Promise<unknown> {
    const request = messageSchema.parse(JSON.parse(JSON.stringify(envelope)));
    if (request.messageType !== 'request') throw new Error('Tool calls require request messages');
    const tool = this.tools.get(name); if (!tool) throw new Error(`Tool unavailable: ${name}`);
    this.messages.push(request);
    const value = await tool(request.payload, request);
    const result = JSON.parse(JSON.stringify(value ?? null)) as unknown;
    this.messages.push({ ...request, from: name, to: request.from, messageType: 'response', payload: result, timestamp: new Date().toISOString() });
    return result;
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
