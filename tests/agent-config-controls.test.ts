import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({admin:true,sameOrigin:true,rows:[] as Array<Record<string,unknown>>,writes:[] as Array<Record<string,unknown>>}));
vi.mock('../src/lib/api-auth',()=>({authenticateRequest:async()=>({ok:true,auth:{userId:'owner-1',isPlatformAdmin:state.admin}})}));
vi.mock('../src/lib/auth',()=>({assertSameOrigin:()=>{if(!state.sameOrigin)throw new Error('origin');}}));
vi.mock('next/server',async()=>{const actual=await vi.importActual<typeof import('next/server')>('next/server');return {...actual,after:vi.fn()};});
vi.mock('../src/lib/db',()=>{
  const executor={execute:async()=>{},select:()=>({from:()=>({where:()=>({orderBy:async()=>state.rows})})}),insert:()=>({values:(row:Record<string,unknown>)=>{state.writes.push(row);return {returning:async()=>[{...row,id:'config-1'}]};}}),update:()=>({set:(row:Record<string,unknown>)=>{state.writes.push(row);return {where:()=>({returning:async()=>[{...row,id:'config-1'}]})};}})};
  return {db:{...executor,transaction:async(handler:(tx:typeof executor)=>Promise<unknown>)=>handler(executor)}};
});
import {POST} from '../src/app/api/agent-configs/route';
import {effectiveConfig} from '../src/lib/agent-governance';
import {confidenceReviewSummary} from '../src/lib/agent-confidence';

const request=(body:unknown)=>new Request('https://portfolio.example/api/agent-configs',{method:'POST',headers:{'content-type':'application/json',origin:'https://portfolio.example'},body:JSON.stringify(body)});
const draft=()=>{const c=effectiveConfig('bull-agent');return {agentKind:c.agentKind,name:c.name,scope:c.scope,promptAddendum:c.promptAddendum,enabledTools:c.enabledTools,runtimePolicy:c.runtimePolicy};};
describe('admin configuration lifecycle boundaries',()=>{
  beforeEach(()=>{state.admin=true;state.sameOrigin=true;state.rows=[];state.writes=[];});
  it('rejects non-admin mutations',async()=>{state.admin=false;expect((await POST(request(draft()))).status).toBe(403);expect(state.writes).toHaveLength(0);});
  it('rejects cross-origin mutations',async()=>{state.sameOrigin=false;expect((await POST(request(draft()))).status).toBe(403);});
  it('saves an immutable inactive draft without replacing production',async()=>{
    expect((await POST(request(draft()))).status).toBe(201);
    expect(state.writes[0]).toMatchObject({active:false,rolloutState:'draft',versionNumber:1});
    expect(state.writes).toHaveLength(1);
  });
  it('rejects an unregistered tool policy',async()=>{expect((await POST(request({...draft(),enabledTools:['deliver_message','execute_python']}))).status).toBe(400);});
  it('will not activate a version using only a passing safety lint',async()=>{
    state.rows=[{id:'v2',versionNumber:2,name:'Bull',scope:'Assess',promptAddendum:'',enabledTools:['deliver_message'],runtimePolicy:draft().runtimePolicy,rolloutState:'draft',active:false,evaluation:{passed:true}}];
    const response=await POST(request({action:'promote',agentKind:'bull-agent',version:2}));expect(response.status).toBe(400);expect(state.writes).toHaveLength(0);
  });
  it('rejects stale evaluation hashes',async()=>{
    state.rows=[{id:'v2',versionNumber:2,name:'Bull',scope:'Assess',promptAddendum:'',enabledTools:['deliver_message'],runtimePolicy:draft().runtimePolicy,rolloutState:'draft',active:false,evaluation:{passed:true,configurationHash:'old-policy'}}];
    expect((await POST(request({action:'promote',agentKind:'bull-agent',version:2}))).status).toBe(400);
  });
});
describe('human-review confidence diagnostics',()=>{
  it('does not confuse missing feedback with a zero rating',()=>{
    const rows=confidenceReviewSummary([{finalOutput:{confidenceScore:75},accuracyScore:null},{finalOutput:{confidenceScore:75},accuracyScore:'0'},{finalOutput:{confidenceScore:80},accuracyScore:'90'}]);
    const band=rows.find(r=>r.band==='75–89')!;expect(band.samples).toBe(2);expect(band.meanConfidence).toBe(77.5);expect(band.meanHumanRating).toBe(45);
    expect(rows[0].meanHumanRating).toBeNull();
  });
});
