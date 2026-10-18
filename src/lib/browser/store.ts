import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type postgres from 'postgres';
import { sql } from '../foundation/store';
import type { AuthContext } from '../auth';
import { accountCanEdit } from '../account-scope';
import { Command, terminal, type BrowserRun, type BrowserEvent, type Observation } from './contracts';

type Tx = postgres.TransactionSql;
// Explicit text intermediate avoids postgres.js serializing an already encoded
// string as a JSON string when PostgreSQL infers the parameter type as jsonb.
export const json = (value:unknown) => JSON.stringify(value);
async function write(tx:Tx,run:BrowserRun) {
  run.version++;
  await tx`UPDATE gpi_browser_sessions SET payload=${json(run)}::text::jsonb WHERE id=${run.id}`;
}
export async function event(tx:Tx,run:BrowserRun,type:string,summary:string,extra:Partial<BrowserEvent>={}) {
  const item:BrowserEvent={...extra,seq:++run.seq,at:new Date().toISOString(),type,summary};
  await tx`INSERT INTO gpi_browser_events(session_id,seq,payload) VALUES(${run.id},${item.seq},${json(item)}::text::jsonb)`;
}
export async function locked<T>(id:string,fn:(run:BrowserRun,tx:Tx)=>Promise<T>):Promise<T> {
  return await sql().begin(async tx=>{
    const rows=await tx`SELECT payload FROM gpi_browser_sessions WHERE id=${id} FOR UPDATE`;
    if(!rows[0])throw Error('not_found');
    const run=rows[0].payload as BrowserRun;
    const result=await fn(run,tx);await write(tx,run);return result;
  }) as T;
}
export async function createRun(auth:AuthContext,input:BrowserRun['input'],issuerId:string,companyName:string) {
  return sql().begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${auth.userId},5))`;
    const existing=await tx`SELECT payload FROM gpi_browser_sessions WHERE owner_id=${auth.userId} AND idempotency_key=${input.idempotencyKey}`;
    if(existing[0]){const r=existing[0].payload as BrowserRun;if(!isDeepStrictEqual(r.input,input))throw Error('idempotency_conflict');return r;}
    // Serialize admission and claims across replicas. An idle worker advertises a
    // short lease only after Chromium preflight; queued runs reserve those slots.
    await tx`SELECT pg_advisory_xact_lock(793134766)`;
    const capacity=await tx`SELECT count(*)::int AS n FROM gpi_browser_workers WHERE ready_until>now() AND busy=false`;
    const queued=await tx`SELECT count(*)::int AS n FROM gpi_browser_sessions WHERE payload->>'state'='queued'`;
    if(capacity[0].n<=queued[0].n)throw Error('browser_capacity_unavailable');
    const rows=await tx`SELECT payload FROM gpi_browser_sessions WHERE owner_id=${auth.userId} AND created_at>now()-interval '24 hours'`;
    if(rows.length>=10||rows.some(r=>!terminal(r.payload.state)&&r.payload.expiresAt>Date.now()))throw Error('browser_quota');
    const now=Date.now();
    const run:BrowserRun={id:randomUUID(),owner:auth.userId,actor:auth.actorUserId,authSession:auth.sessionId,accountId:auth.accountId,
      input,issuerId,companyName,state:'queued',epoch:0,version:0,seq:0,controller:null,createdAt:now,expiresAt:now+600_000,
      leaseUntil:now+30_000,worker:null,actions:0,calls:0,tokens:0,reason:null,observation:null,evidence:[]};
    await tx`INSERT INTO gpi_browser_sessions(id,owner_id,idempotency_key,payload) VALUES(${run.id},${run.owner},${input.idempotencyKey},${json(run)}::text::jsonb)`;
    await event(tx,run,'queued',input.mode==='fixture'?'Deterministic fixture operator queued':'AI public research operator queued');
    await write(tx,run);return run;
  });
}
export async function readRun(owner:string,id:string) {
  const rows=await sql()`SELECT payload FROM gpi_browser_sessions WHERE id=${id} AND owner_id=${owner}`;
  return rows[0]?.payload as BrowserRun|undefined;
}
export async function submit(auth:AuthContext,id:string,value:unknown) {
  if(!accountCanEdit(auth.role))throw Error('forbidden');
  const command=Command.parse(value);
  return locked(id,async(run,tx)=>{
    if(run.owner!==auth.userId)throw Error('not_found');
    if(run.actor!==auth.actorUserId||run.authSession!==auth.sessionId)throw Error('creator_session_required');
    const old=await tx`SELECT payload FROM gpi_browser_commands WHERE session_id=${id} AND id=${command.id}`;
    if(old[0]){if(!isDeepStrictEqual(old[0].payload,command))throw Error('idempotency_conflict');return run;}
    if(terminal(run.state)||run.expiresAt<=Date.now())throw Error('session_closed');
    if(run.state==='queued'){
      if(command.kind!=='stop')throw Error('wait_for_worker');
      run.state='cancelled';run.epoch++;await event(tx,run,'cancelled','Cancelled before browser creation');return run;
    }
    if(command.epoch!==run.epoch)throw Error('stale_control');
    if(run.controller&&run.controller!==auth.actorUserId)throw Error('control_owned');
    const pending=await tx`SELECT count(*)::int AS n FROM gpi_browser_commands WHERE session_id=${id} AND status='pending'`;
    if(pending[0].n>=4)throw Error('command_queue_full');
    const total=await tx`SELECT count(*)::int AS n FROM gpi_browser_commands WHERE session_id=${id}`;
    if(total[0].n>=60&&command.kind!=='stop')throw Error('command_budget_exhausted');
    if(command.kind==='input'){
      if(run.state!=='human'||run.controller!==auth.actorUserId||run.observation?.id!==command.observationId)throw Error('stale_input');
    } else {
      run.epoch++;
      run.state=command.kind==='stop'?'cancelling':'pausing';
    }
    await tx`INSERT INTO gpi_browser_commands(session_id,id,actor_id,payload) VALUES(${id},${command.id},${auth.actorUserId},${json(command)}::text::jsonb)`;
    await event(tx,run,'command_received',`${command.kind} requested; awaiting worker acknowledgement`,{actionId:command.id});
    return run;
  });
}
/** Recheck live login and membership before every worker action, including human input. */
export async function activeAuthority(run:BrowserRun,tx:Tx) {
  const rows=await tx`SELECT 1 FROM user_sessions s JOIN users u ON u.id=s.user_id
    JOIN accounts a ON a.id=${run.accountId}::uuid
    LEFT JOIN memberships m ON m.account_id=a.id AND m.user_id=u.id
    WHERE s.id=${run.authSession}::uuid AND s.user_id=${run.actor}::uuid AND s.revoked_at IS NULL
    AND s.expires_at>now() AND s.last_seen_at>now()-interval '8 hours' AND u.disabled_at IS NULL
    AND a.owner_user_id=${run.owner}::uuid AND (u.role='platform_admin' OR (m.accepted_at IS NOT NULL AND m.role IN ('owner','analyst')))`;
  return rows.length===1;
}
export async function retainObservation(tx:Tx,run:BrowserRun,o:Observation) {
  run.observation=o;
  await tx`INSERT INTO gpi_browser_observations(session_id,id,payload) VALUES(${run.id},${o.id},${json(o)}::text::jsonb) ON CONFLICT DO NOTHING`;
}
export async function claimRun(worker:string) {
  return sql().begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(793134766)`;
    const rows=await tx`SELECT payload FROM gpi_browser_sessions WHERE payload->>'state'='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`;
    if(!rows[0])return null;
    const run=rows[0].payload as BrowserRun;
    await tx`UPDATE gpi_browser_workers SET busy=true WHERE id=${worker}::uuid`;
    run.worker=worker;run.state='running';run.leaseUntil=Date.now()+30_000;
    await event(tx,run,'starting','Starting isolated public browser');await write(tx,run);return run;
  });
}
export async function advertiseBrowserWorker(worker:string,ready:boolean) {
  if(!ready){await sql()`DELETE FROM gpi_browser_workers WHERE id=${worker}::uuid`;return;}
  await sql()`INSERT INTO gpi_browser_workers(id,ready_until,busy) VALUES(${worker}::uuid,now()+interval '5 seconds',false)
    ON CONFLICT(id) DO UPDATE SET ready_until=EXCLUDED.ready_until,busy=false`;
}
export async function reapRuns() {
  // Never reclaim running actions: the external outcome may be unknown.
  await sql()`UPDATE gpi_browser_sessions SET payload=payload||jsonb_build_object('state','reconciling','reason','worker_or_session_expired','controller',null,'observation',null,'epoch',(payload->>'epoch')::int+1)
    WHERE payload->>'state' NOT IN ('cancelled','completed','partial','failed','expired','reconciling')
    AND ((payload->>'expiresAt')::bigint<${Date.now()} OR (payload->>'leaseUntil')::bigint<${Date.now()})`;
  // Observation/event/command retention: 7 days; accepted corpus excerpts follow corpus policy.
  await sql()`DELETE FROM gpi_browser_sessions WHERE created_at<now()-interval '7 days'`;
}
