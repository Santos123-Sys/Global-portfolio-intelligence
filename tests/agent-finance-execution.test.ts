import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({ownsLease:true,writes:[] as unknown[]}));
vi.mock('../src/lib/db',()=>({db:{
  insert:()=>({values:(value:unknown)=>({returning:async()=>{state.writes.push(value);return [{id:'00000000-0000-4000-8000-000000000002'}];}})}),
  update:()=>({set:(value:unknown)=>({where:()=>{state.writes.push(value);return {returning:async()=>state.ownsLease?[{id:'owned'}]:[]};}})}),
  select:()=>({from:()=>({where:async()=>state.ownsLease ? [{id:'owned'}] : []})}),
}}));
import {ExecutionEngine} from '../src/lib/agent-finance/l3/execution-engine';
import {ToolRegistry} from '../src/lib/agent-finance/l3/tool-registry';
import {evidenceOutput} from '../src/lib/agent-finance/contracts';
describe('persisted execution and JSON QA feedback',()=>{
  beforeEach(()=>{state.ownsLease=true;state.writes=[];});
  const registry=()=>new ToolRegistry().register('deliver_message',async p=>p).register('verify_claims',async()=>[]);
  it('retries unsupported claims with JSON feedback and retains only the validated result',async()=>{
    const tools=registry(),engine=new ExecutionEngine('00000000-0000-4000-8000-000000000001',tools,{source:'Revenue 100'});
    let count=0;
    const result=await engine.run('fundamental-analyst',async prior=>{
      count++;if(count===2) expect(prior['qa-feedback'].data.errors).toBeDefined();
      return {...evidenceOutput({revenue:100},['Use retained filing'],['source']),claims:[{text:'Revenue is 100',citations:['source'],evidence:count===1 ? 'Revenue 999' : 'Revenue 100'}]};
    });
    expect(count).toBe(2);expect(result.status).toBe('completed');
    expect(tools.messages.some(row=>row.from==='quality-validator')).toBe(true);
    expect(state.writes.some(row=>(row as {status?:string}).status==='completed')).toBe(true);
  });
  it('bounds retries and turns rejected outputs into a blocked auditable run',async()=>{
    const engine=new ExecutionEngine('00000000-0000-4000-8000-000000000001',registry(),{source:'Revenue 100'});
    const handler=vi.fn(async()=>({...evidenceOutput({},['Audit'],['source']),claims:[{text:'Invented',citations:['source'],evidence:'not in source'}]}));
    const result=await engine.run('quality-analyst',handler);
    expect(handler).toHaveBeenCalledTimes(3);expect(result.status).toBe('blocked');expect(result.confidenceScore).toBe(0);
  });
  it('resumes completed outputs without another paid execution and fences a lost lease',async()=>{
    const engine=new ExecutionEngine('00000000-0000-4000-8000-000000000001',registry(),{source:'Revenue 100'},'00000000-0000-4000-8000-000000000003');
    engine.outputs['projection-builder']=evidenceOutput({},['Reconciled'],['source']);
    const handler=vi.fn();await engine.run('projection-builder',handler);expect(handler).not.toHaveBeenCalled();
    state.ownsLease=false;await expect(engine.run('projection-builder',handler)).rejects.toThrow('lease lost');
  });
  it('does not retry or publish an in-flight model result after pause or cancellation',async()=>{
    const engine=new ExecutionEngine('00000000-0000-4000-8000-000000000001',registry(),{source:'Revenue 100'},'00000000-0000-4000-8000-000000000003');
    const handler=vi.fn(async()=>{state.ownsLease=false;return evidenceOutput({},['Retained source'],['source']);});
    await expect(engine.run('quality-analyst',handler)).rejects.toThrow('lease lost');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(state.writes.some(row=>['completed','failed'].includes((row as {status?:string}).status ?? ''))).toBe(false);
    expect(engine.outputs['quality-analyst']).toBeUndefined();
  });
});
