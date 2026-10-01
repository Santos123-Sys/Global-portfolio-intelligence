import {describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {buildAgentActivityInspector} from '../src/lib/agent-finance/activity-inspector';
import {sanitizeActivityDetail} from '../src/lib/agent-finance/l3/session-events';
import {ToolRegistry} from '../src/lib/agent-finance/l3/tool-registry';
import {effectiveConfig} from '../src/lib/agent-governance';

const sessionId='00000000-0000-4000-8000-000000000001';
const now=new Date('2026-10-01T10:00:00.000Z');
const output={status:'completed' as const,data:{findings:['Margins improved'],metric:42},reasoningChain:['Compared two retained annual filings.'],confidenceScore:82,citations:['https://issuer.example/report'],limitations:['Footnotes require human review.'],
  claims:[{text:'Margins improved',citations:['https://issuer.example/report'],evidence:'margin improved'}],runtimeMetadata:{model:'gpt-6-sol',inputTokens:100,outputTokens:50,latencyMs:800,estimatedCost:null},
  dataQuality:{status:'verified' as const,completeness:1,issues:[],asOf:'2025-12-31'},sourceLineage:[{field:'operating_margin:2025',source:'https://issuer.example/report',provider:'cvm',asOf:'2025-12-31',quality:'official_api' as const}]};

describe('user-safe Agent Activity Inspector',()=>{
  it('exposes active work, tools, evidence, artifacts and configuration identifiers without prompts',()=>{
    const config=effectiveConfig('fundamental-analyst');
    const inspector=buildAgentActivityInspector({configurationSnapshot:{'fundamental-analyst':{...config,protectedPolicy:'DO NOT EXPOSE',promptAddendum:'PRIVATE CUSTOMIZATION'}},
      runs:[{id:'run-1',agentName:'fundamental-analyst',status:'completed',startedAt:new Date(now.getTime()-5_000),completedAt:now,executionTimeMs:5_000,configurationHash:config.configurationHash,outputPayload:output}],
      traces:[{id:'trace-1',agentName:'fundamental-analyst',toolName:'fetch_financial_statements',status:'completed',latencyMs:25,errorCode:null,configurationHash:config.configurationHash,createdAt:now}],events:[{eventType:'retry',agent:'fundamental-analyst'}]});
    expect(inspector.runs[0]).toMatchObject({model:'gpt-6-sol',retryCount:1,currentTool:null,confidenceScore:82});
    expect(inspector.toolActivity[0].task).toContain('financial statement');
    expect(inspector.evidence[0]).toMatchObject({provider:'cvm',quality:'official_api',agents:['fundamental-analyst']});
    expect(inspector.artifacts[0].findings).toContain('Margins improved');
    expect(JSON.stringify(inspector)).not.toContain('DO NOT EXPOSE');expect(JSON.stringify(inspector)).not.toContain('PRIVATE CUSTOMIZATION');
  });
  it('identifies the current registered tool from a durable start trace',()=>{
    const inspector=buildAgentActivityInspector({configurationSnapshot:{},runs:[{id:'run-2',agentName:'technical-analyst',status:'running',startedAt:now,completedAt:null,executionTimeMs:null,configurationHash:null,outputPayload:null}],
      traces:[{id:'trace-2',agentName:'technical-analyst',toolName:'fetch_price_history',status:'started',latencyMs:0,errorCode:null,configurationHash:null,createdAt:now}],events:[]});
    expect(inspector.runs[0].currentTool).toBe('fetch_price_history');expect(inspector.artifacts).toHaveLength(0);
  });
  it('redacts credentials and signed query strings from durable user-visible errors',()=>{
    const sanitized=sanitizeActivityDetail('Bearer secret-value API_KEY=abcd1234 https://example.com/data?signature=secret sk-1234567890abcdef');
    expect(sanitized).not.toContain('secret-value');expect(sanitized).not.toContain('abcd1234');expect(sanitized).not.toContain('signature=secret');expect(sanitized).not.toContain('sk-123');
  });
  it('keeps raw snapshots, prompts and inputs out of the owner session response',()=>{
    const route=readFileSync('src/app/api/agents/sessions/[sessionId]/route.ts','utf8');
    expect(route).toContain('evidenceSnapshot,configurationSnapshot,leaseOwner,leaseExpiresAt,requestPayload,ownerId,...publicSession');
    expect(route).toContain('buildAgentActivityInspector');expect(route).toContain('publicRuns');
    expect(route).toContain('sanitizeActivityDetail(event.detail)');
    expect(route).toContain("companyView=view==='company'");expect(route).toContain('inspector=companyView?null:');expect(route).toContain('liveStatus');
    const sessionsRoute=readFileSync('src/app/api/agents/sessions/route.ts','utf8');
    expect(sessionsRoute).toContain('isPlatformAdmin');expect(sessionsRoute).toContain('requestPayload:agentAnalysisSessions.requestPayload');
    expect(sessionsRoute).toContain('ticker:request.success?request.data.ticker');expect(sessionsRoute).not.toContain('configurationSnapshot:agentAnalysisSessions');
    expect(sessionsRoute).toContain('operations?undefined:eq(agentAnalysisSessions.ownerId, auth.auth.userId)');
    expect(route).toContain("view==='operations'");expect(route).toContain('operationsView?undefined:eq(agentAnalysisSessions.ownerId, auth.auth.userId)');
    const component=readFileSync('src/components/dashboard/agent-activity-inspector.tsx','utf8');
    for(const label of ['Live agents','Evidence','Artifacts','Audit trail','Observability and privacy boundary'])expect(component).toContain(label);
    const analysis=readFileSync('src/components/dashboard/agent-analysis.tsx','utf8');
    expect(analysis).not.toContain('AgentActivityInspectorPanel');expect(analysis).toContain('view=company');
    const operations=readFileSync('src/components/research-operations/agent-research-operations.tsx','utf8');
    expect(operations).toContain('AgentActivityInspectorPanel');expect(operations).toContain('Platform admin');
  });
});

describe('registered tool lifecycle traces',()=>{
  it('records a safe start and terminal event around successful handlers',async()=>{
    const config=effectiveConfig('technical-analyst'),trace=vi.fn(async()=>{}),registry=new ToolRegistry({sessionId,configs:{'technical-analyst':config},trace}).register('fetch_price_history',async()=>[]);
    await registry.invoke('fetch_price_history',{from:'technical-analyst',to:'fetch_price_history',messageType:'request',payload:{},timestamp:now.toISOString(),sessionId});
    expect(trace).toHaveBeenNthCalledWith(1,expect.objectContaining({status:'started',toolName:'fetch_price_history',latencyMs:0}));
    expect(trace).toHaveBeenNthCalledWith(2,expect.objectContaining({status:'completed',toolName:'fetch_price_history',errorCode:null}));
  });
});
