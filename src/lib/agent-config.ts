import { and, desc, eq } from 'drizzle-orm';
import {
  AgentCustomization,
  type AgentKind,
  type AgentTool,
} from '@portfolio-intelligence/agentic-contract';
import { db } from './db';
import { agentConfigurations } from './db/workflow-schema';
import { effectiveConfig } from './agent-governance';

const ALLOWED_TOOLS: Record<AgentKind, AgentTool[]> = {
  thesis_extraction: ['thesis_document'],
  market_research: ['structured_universe', 'web_search'],
  security_analysis: ['grounding_bundle'],
  portfolio_synthesis: ['grounding_bundle'],
};

export function defaultAgentCustomization(kind: AgentKind): AgentCustomization {
  const config=effectiveConfig(kind);
  return AgentCustomization.parse({agentKind:kind,configVersion:1,name:config.name,scope:config.scope,promptAddendum:config.promptAddendum,enabledTools:config.enabledTools,runtimePolicy:config.runtimePolicy,configurationHash:config.configurationHash});
}

export function validateAgentTools(kind: AgentKind, tools: AgentTool[]): void {
  const allowed = new Set(ALLOWED_TOOLS[kind]);
  const invalid = tools.filter((tool) => !allowed.has(tool));
  if (invalid.length) throw new Error(`${kind} cannot use these tools: ${invalid.join(', ')}`);
  if (kind === 'market_research' && !tools.includes('structured_universe')) {
    throw new Error('Market research must keep the structured_universe tool enabled');
  }
  if (kind !== 'market_research' && tools.length === 0) {
    throw new Error(`${kind} must keep its grounding tool enabled`);
  }
}

export async function getActiveAgentCustomization(ownerId: string, kind: AgentKind): Promise<AgentCustomization> {
  const [row] = await db.select().from(agentConfigurations).where(and(
    eq(agentConfigurations.ownerId, ownerId),
    eq(agentConfigurations.agentKind, kind),
    eq(agentConfigurations.active, true),
    eq(agentConfigurations.rolloutState,'production')
  )).orderBy(desc(agentConfigurations.versionNumber)).limit(1);
  if (!row) return defaultAgentCustomization(kind);
  const parsed = AgentCustomization.parse({
    agentKind: row.agentKind,
    configVersion: row.versionNumber,
    name: row.name,
    scope: row.scope,
    promptAddendum: row.promptAddendum,
    enabledTools: row.enabledTools,
    runtimePolicy: effectiveConfig(kind,row).runtimePolicy,
    configurationHash: effectiveConfig(kind,row).configurationHash,
  });
  validateAgentTools(parsed.agentKind, parsed.enabledTools);
  return parsed;
}

export function allowedToolsFor(kind: AgentKind): AgentTool[] {
  return [...ALLOWED_TOOLS[kind]];
}
