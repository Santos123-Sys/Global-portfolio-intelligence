import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { sql } from '../foundation/store';

export type RuntimeState = {
  generation:string; phase:'idle'|'building'|'creating'|'starting'|'ready'|'recovering'|'blocked';
  vmId:string|null; session:string|null; release:string; reason:string|null;
  attempts:number; windowStarted:number; changedAt:number; retryAt:number;
};
type Tx = postgres.TransactionSql;
export async function acquireRuntime(owner:string,release:string):Promise<RuntimeState|null> {
  return await sql().begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(793134767)`;
    const rows=await tx`SELECT owner,payload,lease_until>now() AS held FROM gpi_browser_runtime WHERE id='browser' FOR UPDATE`;
    if(rows[0]?.held&&rows[0].owner!==owner)return null;
    const now=Date.now();
    const state:RuntimeState=rows[0]?.payload??{generation:randomUUID(),phase:'idle',vmId:null,session:null,release,reason:null,
      attempts:0,windowStarted:now,changedAt:now,retryAt:0};
    if(rows[0]&&rows[0].owner!==owner){
      // Immediately fence the old VM. A known VM is destroyed before replacement.
      const unknown=state.phase==='creating'&&!state.vmId;
      state.phase=state.vmId?'recovering':unknown?'blocked':'idle';
      state.reason=unknown?'creation_outcome_unknown':'controller_replaced';state.changedAt=now;
    }
    if(state.release!==release&&state.vmId){state.phase='recovering';state.reason='release_changed';}
    await tx`INSERT INTO gpi_browser_runtime(id,owner,lease_until,payload) VALUES('browser',${owner},now()+interval '45 seconds',${JSON.stringify(state)}::text::jsonb)
      ON CONFLICT(id) DO UPDATE SET owner=EXCLUDED.owner,lease_until=EXCLUDED.lease_until,payload=EXCLUDED.payload`;
    return state;
  }) as RuntimeState|null;
}
export async function renewRuntime(owner:string) {
  const rows=await sql()`UPDATE gpi_browser_runtime SET lease_until=now()+interval '45 seconds'
    WHERE id='browser' AND owner=${owner} AND lease_until>now() RETURNING id`;
  return rows.length===1;
}
export async function mutateRuntime(owner:string,fn:(state:RuntimeState)=>void) {
  return await sql().begin(async tx=>{
    const rows=await tx`SELECT payload FROM gpi_browser_runtime WHERE id='browser' AND owner=${owner} AND lease_until>now() FOR UPDATE`;
    if(!rows[0])throw Error('runtime_lease_lost');
    const state=rows[0].payload as RuntimeState;fn(state);
    await tx`UPDATE gpi_browser_runtime SET payload=${JSON.stringify(state)}::text::jsonb WHERE id='browser'`;
    return state;
  }) as RuntimeState;
}
export async function runtimePermitsWorker(tx?:Tx,readyOnly=false) {
  const generation=process.env.BROWSER_RUNTIME_GENERATION;
  if(!generation)return process.env.NODE_ENV!=='production';
  const rows=await (tx??sql())`SELECT 1 FROM gpi_browser_runtime WHERE id='browser' AND lease_until>now()
    AND payload->>'generation'=${generation} AND (payload->>'phase'='ready' OR (${!readyOnly} AND payload->>'phase'='starting'))`;
  return rows.length===1;
}
export async function runtimeWorkerHealthy(generation:string) {
  return (await sql()`SELECT 1 FROM gpi_browser_workers WHERE runtime_generation=${generation}::uuid AND ready_until>now() LIMIT 1`).length>0;
}
export async function reconcileRuntime(generation:string) {
  // Call only after confirmed VM destruction. Never reclaim or replay an effect.
  await sql()`UPDATE gpi_browser_sessions SET payload=payload||jsonb_build_object('state','reconciling','reason','browser_vm_replaced',
    'controller',null,'observation',null,'epoch',(payload->>'epoch')::int+1)
    WHERE (payload->>'runtimeGeneration'=${generation} OR payload->>'worker' IN (SELECT id::text FROM gpi_browser_workers WHERE runtime_generation=${generation}::uuid))
    AND payload->>'state' NOT IN ('cancelled','completed','partial','failed','expired','reconciling')`;
  await sql()`DELETE FROM gpi_browser_workers WHERE runtime_generation=${generation}::uuid`;
}
export async function runtimeStatus() {
  const rows=await sql()`SELECT payload->>'phase' AS phase,payload->>'reason' AS reason,lease_until>now() AS held FROM gpi_browser_runtime WHERE id='browser'`;
  return rows[0]?{phase:rows[0].held?rows[0].phase:'unavailable',reason:rows[0].reason}:{phase:'unconfigured',reason:null};
}
