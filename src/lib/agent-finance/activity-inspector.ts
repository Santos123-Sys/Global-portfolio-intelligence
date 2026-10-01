import { z } from 'zod';
import { agentDefinition } from '@portfolio-intelligence/agentic-contract';
import { outputSchema, type AgentOutput } from './contracts';

const configurationSchema=z.record(z.object({
  name:z.string().optional(),scope:z.string().optional(),configurationHash:z.string().optional(),configVersion:z.number().optional(),implementationRevision:z.string().optional(),
  runtimePolicy:z.object({model:z.string(),reasoningEffort:z.string(),maxAttempts:z.number().int()}).passthrough().optional(),
}).passthrough());

export interface InspectorRun {
  id:string;agentName:string;label:string;task:string;status:string;startedAt:string;completedAt:string|null;executionTimeMs:number|null;
  configurationHash:string|null;configurationVersion:number|null;implementationRevision:string|null;model:string|null;reasoningEffort:string|null;
  retryCount:number;currentTool:string|null;currentToolTask:string|null;confidenceScore:number|null;dataQuality:AgentOutput['dataQuality']|null;
}
export interface InspectorToolTrace {id:string;agentName:string;toolName:string;task:string;status:string;latencyMs:number;errorCode:string|null;configurationHash:string|null;occurredAt:string}
export interface InspectorEvidence {source:string;provider:string;asOf:string|null;quality:string;agents:string[];fields:string[]}
export interface InspectorArtifact {id:string;agentName:string;status:string;createdAt:string;confidenceScore:number;findings:string[];reasoningSummary:string[];dataKeys:string[];citations:string[];limitations:string[];dataQuality:AgentOutput['dataQuality']|null}
export interface AgentActivityInspector {runs:InspectorRun[];toolActivity:InspectorToolTrace[];evidence:InspectorEvidence[];artifacts:InspectorArtifact[];privacyNotice:string}

type RunRow={id:string;agentName:string;status:string;startedAt:Date;completedAt:Date|null;executionTimeMs:number|null;configurationHash:string|null;outputPayload:unknown};
type TraceRow={id:string;agentName:string;toolName:string;status:string;latencyMs:number;errorCode:string|null;configurationHash:string|null;createdAt:Date};
type EventRow={eventType:string;agent:string|null};

const toolTasks:Record<string,string>={
  fetch_comprehensive_data:'Load the frozen company evidence snapshot',fetch_financial_statements:'Read retained financial statement facts',fetch_price_history:'Read retained market-price history',
  fetch_analyst_estimates:'Check attributed analyst estimates',fetch_filings:'Read retained regulatory and issuer filings',fetch_news:'Read NewsAdapter articles',fetch_peer_data:'Read reviewed peer evidence',
  query_documents:'Retrieve relevant owned document passages',calculate_wacc:'Run the registered cost-of-capital calculation',run_dcf:'Run the deterministic DCF calculation',run_monte_carlo:'Run the reviewed simulation policy',
  analyze_financial_statements:'Calculate normalized statement metrics and quality signals',research_market_structure:'Prepare sector-relevant market research modules',calculate_value_scorecard:'Aggregate supported thesis score criteria',
  verify_claims:'Check public claims against retained evidence',retrieve_memory:'Read short-lived issuer research memory',store_memory:'Save the reviewable research result',deliver_message:'Transfer governed JSON context between agents',
};
const iso=(value:Date|null)=>value?.toISOString() ?? null;
function definitionFor(agentName:string) {try{return agentDefinition(agentName.replace(/:shadow$/,''));}catch{return null;}}
function findings(output:AgentOutput) {
  const dataFindings=Array.isArray(output.data.findings) ? output.data.findings.filter((value):value is string=>typeof value==='string') : [];
  return [...new Set([...(output.claims?.map(claim=>claim.text) ?? []),...dataFindings])].slice(0,12);
}

/** Builds a user-safe inspection view. Raw prompts, tool payloads, private reasoning and evidence excerpts are deliberately excluded. */
export function buildAgentActivityInspector(input:{configurationSnapshot:unknown;runs:RunRow[];traces:TraceRow[];events:EventRow[]}):AgentActivityInspector {
  const parsed=configurationSchema.safeParse(input.configurationSnapshot);const configurations=parsed.success?parsed.data:{};
  const outputs=new Map<string,AgentOutput>();
  for(const run of input.runs){const output=outputSchema.safeParse(run.outputPayload);if(output.success)outputs.set(run.id,output.data);}
  const latestTool=new Map<string,TraceRow>();for(const trace of input.traces)latestTool.set(trace.agentName,trace);
  const runs=input.runs.map(run=>{
    const output=outputs.get(run.id);const config=configurations[run.agentName] ?? configurations[run.agentName.replace(/:shadow$/,'')];const definition=definitionFor(run.agentName);const tool=latestTool.get(run.agentName);
    return {id:run.id,agentName:run.agentName,label:config?.name ?? run.agentName.replaceAll('-',' '),task:config?.scope ?? definition?.objective ?? 'Produce a governed research artifact',status:run.status,
      startedAt:run.startedAt.toISOString(),completedAt:iso(run.completedAt),executionTimeMs:run.executionTimeMs,configurationHash:run.configurationHash ?? config?.configurationHash ?? null,
      configurationVersion:config?.configVersion ?? null,implementationRevision:config?.implementationRevision ?? null,model:output?.runtimeMetadata?.model ?? config?.runtimePolicy?.model ?? (definition?.execution==='deterministic'?'deterministic':null),
      reasoningEffort:config?.runtimePolicy?.reasoningEffort ?? null,retryCount:input.events.filter(event=>event.eventType==='retry'&&event.agent===run.agentName).length,
      currentTool:tool?.status==='started'?tool.toolName:null,currentToolTask:tool?.status==='started'?(toolTasks[tool.toolName] ?? 'Run a registered tool'):null,confidenceScore:output?.confidenceScore ?? null,dataQuality:output?.dataQuality ?? null};
  });
  const toolActivity=input.traces.map(trace=>({id:trace.id,agentName:trace.agentName,toolName:trace.toolName,task:toolTasks[trace.toolName] ?? 'Run a registered tool',status:trace.status,latencyMs:trace.latencyMs,errorCode:trace.errorCode,configurationHash:trace.configurationHash,occurredAt:trace.createdAt.toISOString()}));
  const evidenceMap=new Map<string,InspectorEvidence>();const artifacts:InspectorArtifact[]=[];
  for(const run of input.runs){const output=outputs.get(run.id);if(!output)continue;
    const lineages=new Map((output.sourceLineage ?? []).map(row=>[row.source,row]));
    for(const source of output.citations){const lineage=lineages.get(source);const current=evidenceMap.get(source) ?? {source,provider:lineage?.provider ?? 'retained evidence',asOf:lineage?.asOf ?? null,quality:lineage?.quality ?? 'not classified',agents:[],fields:[]};
      if(!current.agents.includes(run.agentName))current.agents.push(run.agentName);for(const row of output.sourceLineage?.filter(item=>item.source===source) ?? [])if(!current.fields.includes(row.field))current.fields.push(row.field);evidenceMap.set(source,current);}
    artifacts.push({id:run.id,agentName:run.agentName,status:output.status,createdAt:(run.completedAt ?? run.startedAt).toISOString(),confidenceScore:output.confidenceScore,findings:findings(output),reasoningSummary:output.reasoningChain.slice(0,12),dataKeys:Object.keys(output.data).slice(0,30),citations:output.citations,limitations:output.limitations.slice(0,12),dataQuality:output.dataQuality ?? null});
  }
  return {runs,toolActivity,evidence:[...evidenceMap.values()],artifacts,privacyNotice:'Shows public audit summaries, registered tool activity and retained source references. Private chain-of-thought, raw prompts, credentials and raw tool payloads are never exposed.'};
}
