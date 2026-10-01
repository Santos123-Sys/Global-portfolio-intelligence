import {beforeEach,describe,expect,it,vi} from 'vitest';
const id='00000000-0000-4000-8000-000000000001';
const state=vi.hoisted(()=>({denied:0,sameOrigin:true,status:'running',rows:[] as unknown[],capacity:0,raced:false,writes:[] as Array<Record<string,unknown>>}));
vi.mock('../src/lib/api-auth',()=>({authenticateRequest:async()=>state.denied ? {ok:false,response:Response.json({error:'Denied'},{status:state.denied})} : {ok:true,auth:{userId:'owner',actorUserId:'actor'}}}));
vi.mock('../src/lib/auth',()=>({assertSameOrigin:()=>{if(!state.sameOrigin)throw new Error('Cross-origin');}}));
vi.mock('../src/lib/agent-finance/l3/review',()=>({analysisScopes:async()=>state.rows}));
vi.mock('../src/lib/db',()=>{
  const executor={execute:async()=>{},select:()=>({from:()=>({where:()=>({limit:async(n:number)=>n===3?Array.from({length:state.capacity},()=>({id:'active'})):state.rows})})}),update:()=>({set:(row:Record<string,unknown>)=>({where:()=>{state.writes.push(row);return {returning:async()=>state.raced?[]:[{id:'saved'}]};}})}),insert:()=>({values:async(row:Record<string,unknown>)=>{state.writes.push(row);}})};
  return {db:{...executor,transaction:async(fn:(tx:typeof executor)=>Promise<unknown>)=>fn(executor)}};
});
import {POST as control} from '../src/app/api/agents/sessions/[sessionId]/control/route';
import {POST as review} from '../src/app/api/agents/sessions/[sessionId]/financial-review/route';
const params={params:Promise.resolve({sessionId:id})};
const request=(body:unknown,path='control')=>new Request(`https://portfolio.example/api/agents/sessions/${id}/${path}`,{method:'POST',headers:{'content-type':'application/json',origin:'https://portfolio.example'},body:JSON.stringify(body)});
const periods=[{date:'2024-12-31',facts:{revenue:100},sources:['https://issuer.example/filing']},{date:'2025-12-31',facts:{revenue:120},sources:['https://issuer.example/filing']}];
const session=(status='running')=>({id,status,securityId:id,requestPayload:{ticker:'TEST',analysisType:'combined'},evidenceSnapshot:{company:{ticker:'TEST',currency:'BRL'},facts:periods[1].facts,history:periods,fiscalDate:periods[1].date,sources:periods[1].sources}});
const reviewBody=()=>({confirmed:true,periods:periods.map(row=>({date:row.date,days:365,sourceQuality:'official_api'}))});
describe('persisted session control routes',()=>{
  beforeEach(()=>{state.denied=0;state.sameOrigin=true;state.capacity=0;state.raced=false;state.writes=[];state.rows=[session()];});
  it('rejects unauthenticated and read-only mutations without writes',async()=>{
    for(const status of [401,403]){state.denied=status;expect((await control(request({action:'pause',confirmed:true}),params)).status).toBe(status);expect((await review(request(reviewBody()),params)).status).toBe(status);}
    expect(state.writes).toHaveLength(0);
  });
  it('rejects cross-origin controls and unconfirmed approval',async()=>{
    state.sameOrigin=false;expect((await control(request({action:'pause',confirmed:true}),params)).status).toBe(403);
    state.sameOrigin=true;expect((await review(request({...reviewBody(),confirmed:false}),params)).status).toBe(400);expect(state.writes).toHaveLength(0);
  });
  it('pauses and retains an interrupted audit record',async()=>{
    expect((await control(request({action:'pause',confirmed:true}),params)).status).toBe(200);
    expect(state.writes[0]).toMatchObject({status:'paused',leaseOwner:null,leaseExpiresAt:null});
    expect(state.writes.some(row=>row.status==='interrupted')).toBe(true);
  });
  it('rejects resurrection, missing ownership and state races',async()=>{
    state.rows=[session('cancelled')];expect((await control(request({action:'resume',confirmed:true}),params)).status).toBe(409);
    state.rows=[];expect((await control(request({action:'pause',confirmed:true}),params)).status).toBe(404);
    state.rows=[session()];state.raced=true;expect((await control(request({action:'pause',confirmed:true}),params)).status).toBe(409);
  });
  it('enforces queue capacity and resets crash attempts on deliberate resume',async()=>{
    state.rows=[session('paused')];state.capacity=3;expect((await control(request({action:'resume',confirmed:true}),params)).status).toBe(429);
    state.capacity=0;expect((await control(request({action:'resume',confirmed:true}),params)).status).toBe(200);
    expect(state.writes[0]).toMatchObject({status:'queued',attempts:0});
  });
  it('requires exact fiscal dates and never rewrites statement facts during approval',async()=>{
    state.rows=[session('awaiting_approval')];
    const wrong=reviewBody();wrong.periods[0].date='2020-12-31';expect((await review(request(wrong),params)).status).toBe(409);expect(state.writes).toHaveLength(0);
    expect((await review(request(reviewBody()),params)).status).toBe(200);
    const saved=state.writes[0];expect(saved).toMatchObject({status:'queued',attempts:0,evidenceSnapshot:{history:periods,financialReview:{periods:reviewBody().periods}}});
    expect(state.writes.some(row=>row.status==='superseded_by_input_review')).toBe(true);
  });
});
