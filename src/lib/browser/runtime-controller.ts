import { randomUUID } from 'node:crypto';
import type { RuntimeState } from './runtime-store';

export interface RuntimeProvider {
  prepare(release:string):Promise<void>;
  create(generation:string):Promise<string>;
  start(vmId:string):Promise<string>;
  running(vmId:string,session:string):Promise<boolean>;
  destroy(vmId:string):Promise<void>;
}
export interface RuntimeRepository {
  mutate(fn:(state:RuntimeState)=>void):Promise<RuntimeState>;
  healthy(generation:string):Promise<boolean>;
  reconcile(generation:string):Promise<void>;
}
/** One leased controller; all effects are fenced and their intent is durable first. */
export async function runtimeTick(state:RuntimeState,release:string,provider:RuntimeProvider,repo:RuntimeRepository,now=Date.now()) {
  const transition=async(phase:RuntimeState['phase'],reason:string|null)=>repo.mutate(s=>{s.phase=phase;s.reason=reason;s.changedAt=now;});
  const fence=async()=>repo.mutate(()=>{});
  if(state.phase==='blocked'){
    if(state.reason==='hourly_replacement_budget'&&now-state.windowStarted>=3_600_000)
      state=await repo.mutate(s=>{s.phase='idle';s.attempts=0;s.windowStarted=now;});
    else if(state.reason==='runtime_build_failed'&&state.release!==release)
      state=await repo.mutate(s=>{s.phase='idle';});
    else return;
  }
  if(state.retryAt>now)return;
  if(state.vmId&&state.release!==release)state=await transition('recovering','release_changed');
  if(state.phase==='recovering'){
    if(!state.vmId){await transition('blocked','destruction_target_unknown');return;}
    await fence();await provider.destroy(state.vmId);
    await repo.reconcile(state.generation);
    await repo.mutate(s=>{s.vmId=null;s.session=null;s.phase='idle';s.reason='vm_destroyed';s.retryAt=now+30_000;s.changedAt=now;});
    return;
  }
  if(state.phase==='creating'){
    // The process may have died after provider creation but before saving its ID.
    await transition('blocked','creation_outcome_unknown');return;
  }
  if(state.phase==='idle'||state.phase==='building'){
    if(now-state.windowStarted>=3_600_000)state=await repo.mutate(s=>{s.attempts=0;s.windowStarted=now;});
    if(state.attempts>=3){await transition('blocked','hourly_replacement_budget');return;}
    await repo.mutate(s=>{s.phase='building';s.reason=null;s.release=release;s.changedAt=now;});
    try{await provider.prepare(release);}catch{await transition('blocked','runtime_build_failed');return;}
    state=await repo.mutate(s=>{s.phase='creating';s.generation=randomUUID();s.release=release;s.attempts++;s.changedAt=now;});
    let vmId:string;
    try{await fence();vmId=await provider.create(state.generation);}
    catch{await transition('blocked','creation_outcome_unknown');return;}
    try{
      state=await repo.mutate(s=>{s.vmId=vmId;s.phase='starting';s.changedAt=Date.now();});
    }catch{
      // Lost controller authority: close the VM we just created, never checkpoint it.
      await provider.destroy(vmId);throw Error('runtime_lease_lost');
    }
    try{
      await fence();const session=await provider.start(vmId);
      await repo.mutate(s=>{s.session=session;});
    }catch{await transition('recovering','worker_start_outcome_unknown');}
    return;
  }
  if(!state.vmId||!state.session){await transition('recovering','worker_session_missing');return;}
  let running=false;
  try{await fence();running=await provider.running(state.vmId,state.session);}catch{
    // Control-plane uncertainty withdraws admission before the next retry.
    await transition('recovering','provider_health_unavailable');return;
  }
  const healthy=running&&await repo.healthy(state.generation);
  if(healthy){if(state.phase!=='ready')await transition('ready',null);return;}
  if(state.phase==='starting'&&running&&now-state.changedAt<60_000)return;
  await transition('recovering',running?'worker_heartbeat_expired':'worker_or_vm_stopped');
}
