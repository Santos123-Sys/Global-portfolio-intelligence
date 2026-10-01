import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { AGENT_REGISTRY, AgentKind, AGENT_REASONING_PROMPTS, GOVERNANCE_VERSION, agentDefinition, rolePolicy, runtimePolicySchema, validateToolPolicy, type RuntimePolicy } from '@portfolio-intelligence/agentic-contract';
import { db } from './db';
import { agentConfigurations } from './db/workflow-schema';

export interface EffectiveAgentConfig {
  agentKind:string; configVersion:number; name:string; scope:string; promptAddendum:string;
  enabledTools:string[]; runtimePolicy:RuntimePolicy; configurationHash:string; protectedPolicy:string;
  implementationRevision:string;
}
export function effectiveConfig(id:string,row?:{versionNumber:number;name:string;scope:string;promptAddendum:string;enabledTools:string[];runtimePolicy:unknown}) : EffectiveAgentConfig {
  const definition=agentDefinition(id);
  const legacy=AgentKind.safeParse(id);
  const protectedPolicy=rolePolicy(id)+(legacy.success ? `\n${AGENT_REASONING_PROMPTS[legacy.data].systemPrompt}` : '');
  const runtimePolicy=runtimePolicySchema.parse(row?.runtimePolicy ?? {model:process.env.OPENAI_MODEL ?? 'gpt-6-sol'});
  const config={agentKind:id,configVersion:row?.versionNumber ?? 1,name:row?.name ?? id.replaceAll('-',' ').replaceAll('_',' '),scope:row?.scope ?? definition.objective,promptAddendum:row?.promptAddendum ?? '',enabledTools:row?.enabledTools ?? definition.tools,runtimePolicy,protectedPolicy,implementationRevision:process.env.RAILWAY_GIT_COMMIT_SHA ?? 'local-unversioned'};
  validateToolPolicy(id,config.enabledTools);
  const configurationHash=createHash('sha256').update(JSON.stringify({governanceVersion:GOVERNANCE_VERSION,...config})).digest('hex');
  return {...config,configurationHash};
}
export async function activeAgentSnapshot(ownerId:string,runId:string=ownerId):Promise<Record<string,EffectiveAgentConfig>> {
  const rows=await db.select().from(agentConfigurations).where(and(eq(agentConfigurations.ownerId,ownerId),eq(agentConfigurations.active,true))).orderBy(desc(agentConfigurations.versionNumber));
  const bucket=parseInt(createHash('sha256').update(runId).digest('hex').slice(0,8),16)%100;
  const result:Record<string,EffectiveAgentConfig>={};
  for(const definition of AGENT_REGISTRY) {
    const candidates=rows.filter(r=>r.agentKind===definition.id);
    const production=candidates.find(r=>r.rolloutState==='production');
    const canary=candidates.find(r=>r.rolloutState==='canary');
    result[definition.id]=effectiveConfig(definition.id,bucket<10 && canary ? canary : production);
    const shadow=candidates.find(r=>r.rolloutState==='shadow');
    if(shadow && definition.execution==='model' && definition.layer==='Analysis Swarm')result[`${definition.id}:shadow`]=effectiveConfig(definition.id,shadow);
  }
  return result;
}
export function selectPrior(id:string,prior:Record<string,import('./agent-finance/contracts').AgentOutput>) {
  const specialists=['fundamental-analyst','technical-analyst','sentiment-analyst','ratio-analyst','quality-analyst'];
  const context=['financial-statement-analyzer','market-industry-research'];
  const allowed=id==='judge-agent' ? [...context,...specialists,'bull-agent','bear-agent','sanity-checker','terminal-value'] : ['bull-agent','bear-agent'].includes(id) ? [...context,...specialists,'sanity-checker','terminal-value'] : id==='analysis-director' || specialists.includes(id) ? [...context,'sanity-checker','terminal-value'] : Object.keys(prior);
  return Object.fromEntries(Object.entries(prior).filter(([key])=>allowed.includes(key) || key==='qa-feedback'));
}
