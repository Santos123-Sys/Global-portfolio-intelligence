import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Transaction } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const state = vi.hoisted(() => ({ db: null as PGlite | null }));
vi.mock('postgres', () => {
  function tag(db: PGlite | Transaction) {
    const fn = async (strings: TemplateStringsArray, ...params: unknown[]) => {
      const query = strings.reduce((q,s,i)=>q+(i?`$${i}`:'')+s,'');
      return (await db.query(query, params)).rows;
    };
    fn.json = (v: unknown) => JSON.stringify(v);
    fn.begin = (work: (tx: ReturnType<typeof tag>) => Promise<unknown>) => state.db!.transaction(tx => work(tag(tx)));
    return fn;
  }
  return {default:()=>tag(state.db!)};
});
import { loadWorkspace,saveWorkspace,enqueue,listJobs,claimJob,finishJob } from '../src/lib/foundation/store';
import { defaultProfile } from '../src/lib/foundation/contracts';
const owner='550e8400-e29b-41d4-a716-446655440000';
const other='550e8400-e29b-41d4-a716-446655440001';
const workspace={version:1,profile:defaultProfile,candidates:[{key:'XNAS:TEST',ticker:'TEST',name:'Synthetic',exchange:'XNAS',market:'us',issuer:null,identitySourceUrl:'https://data.sec.gov/fixture'}]};
const input=(id='550e8400-e29b-41d4-a716-446655440002')=>({kind:'screen',workspace,idempotencyKey:id});
beforeAll(async()=>{
  vi.stubEnv('DATABASE_URL','postgresql://test:test@localhost/test');state.db=new PGlite();
  const migration=readFileSync('migrations/001_foundation.sql','utf8');await state.db.exec(migration);await state.db.exec(migration);
  await state.db.query('INSERT INTO users(id,email,display_name,password_hash) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)',[owner,'one@example.test','One','test',other,'two@example.test','Two','test']);
},30_000);
beforeEach(async()=>{await state.db!.exec('TRUNCATE gpi_foundation_jobs,gpi_foundation_workspaces');});
afterAll(async()=>{await state.db?.close();vi.unstubAllEnvs();});
describe('actual foundation SQL on embedded PostgreSQL',()=>{
  it('persists workspaces with account isolation',async()=>{await saveWorkspace(owner,workspace);expect((await loadWorkspace(owner)).candidates).toHaveLength(1);expect((await loadWorkspace(other)).candidates).toHaveLength(17);});
  it('enqueues idempotently and rejects changed replay payloads',async()=>{const a=await enqueue(owner,input());expect((await enqueue(owner,input())).id).toBe(a.id);await expect(enqueue(owner,{...input(),workspace:{...workspace,profile:{...defaultProfile,name:'Changed'}}})).rejects.toThrow('idempotency_conflict');});
  it('isolates job histories by tenant',async()=>{await enqueue(owner,input());expect(await listJobs(other)).toHaveLength(0);expect(await listJobs(owner)).toHaveLength(1);});
  it('limits active jobs',async()=>{for(let i=2;i<5;i++)await enqueue(owner,input(`550e8400-e29b-41d4-a716-44665544000${i}`));await expect(enqueue(owner,input('550e8400-e29b-41d4-a716-446655440005'))).rejects.toThrow('queue_limit');});
  it('claims only once and fences completion',async()=>{await enqueue(owner,input());const job=(await claimJob())!;expect(job.status).toBe('running');expect(await claimJob()).toBeNull();expect(await finishJob({...job,lease_token:other},{result:'stale'})).toBe(false);expect(await finishJob(job,{result:'complete'})).toBe(true);expect((await listJobs(owner))[0].status).toBe('complete');});
  it('fails expired work without replaying it',async()=>{await enqueue(owner,input());const j=(await claimJob())!;await state.db!.query("UPDATE gpi_foundation_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[j.id]);expect(await claimJob()).toBeNull();expect((await listJobs(owner))[0].error_code).toBe('worker_lease_expired');expect(await finishJob(j,{late:true})).toBe(false);});
  it('retains failed run state',async()=>{await enqueue(owner,input());const j=(await claimJob())!;await finishJob(j,null,'run_failed');expect((await listJobs(owner))[0].status).toBe('failed');});
});
