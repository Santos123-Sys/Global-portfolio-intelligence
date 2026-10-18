import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireRuntime, mutateRuntime, reconcileRuntime, renewRuntime, runtimeWorkerHealthy } from './runtime-store';
import { runtimeTick } from './runtime-controller';
import { RailwayBrowserRuntime,railwayRuntimeConfig } from './railway-runtime';

export async function superviseBrowserRuntime(signal:AbortSignal) {
  const config=railwayRuntimeConfig();
  const provider=new RailwayBrowserRuntime(config);
  while(!signal.aborted){
  const owner=randomUUID();
  let held=false,renewing=false,lost=false,lastPhase='';
  const renewal=setInterval(()=>{
    if(!held||renewing||signal.aborted)return;
    renewing=true;void renewRuntime(owner).then(ok=>{if(!ok)lost=true;}).catch(()=>{lost=true;}).finally(()=>{renewing=false;});
  },5000);
  const repo={mutate:async(fn:Parameters<typeof mutateRuntime>[1])=>{
    if(signal.aborted||lost)throw Error('runtime_lease_lost');return mutateRuntime(owner,fn);
  },healthy:runtimeWorkerHealthy,reconcile:reconcileRuntime};
  try {
    while(!signal.aborted&&!lost){
      try {
      const state=await acquireRuntime(owner,config.release);held=!!state;
      if(state){
        if(state.phase!==lastPhase){lastPhase=state.phase;console.log(JSON.stringify({kind:'browser_runtime',phase:state.phase,reason:state.reason}));}
        await runtimeTick(state,config.release,provider,repo);
      }
      }catch{console.error(JSON.stringify({kind:'browser_runtime',phase:'reconciliation_pending'}));}
      await delay(5000,undefined,{signal}).catch(()=>{});
    }
  } finally {
    clearInterval(renewal);
    // If authority was lost, the next controller owns reconciliation. Otherwise
    // mark draining before destroying the known VM, including on SIGTERM.
    if(held&&!lost){
      try{
        const state=await mutateRuntime(owner,s=>{s.phase=s.vmId?'recovering':s.phase;s.retryAt=0;});
        if(state.vmId){await provider.destroy(state.vmId);await reconcileRuntime(state.generation);
          await mutateRuntime(owner,s=>{s.vmId=null;s.session=null;s.phase='idle';s.reason='supervisor_stopped';});}
      }catch{console.error(JSON.stringify({kind:'browser_runtime',phase:'cleanup_unconfirmed'}));}
    }
  }
  if(!signal.aborted)await delay(30_000,undefined,{signal}).catch(()=>{});
  }
}
