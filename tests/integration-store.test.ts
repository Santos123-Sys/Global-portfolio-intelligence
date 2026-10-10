import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Transaction } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const state = vi.hoisted(() => ({ db: null as PGlite | null }));
vi.mock('postgres', () => {
  function tag(db: PGlite | Transaction) {
    const fn = async (strings: TemplateStringsArray, ...params: unknown[]) => {
      const query = strings.reduce((q, s, i) => q + (i ? '$' + i : '') + s, '');
      return (await db.query(query, params)).rows;
    };
    fn.json = (v: unknown) => JSON.stringify(v);
    fn.begin = (work: (tx: ReturnType<typeof tag>) => Promise<unknown>) =>
      state.db!.transaction(tx => work(tag(tx)));
    return fn;
  }
  return { default: () => tag(state.db!) };
});
import { enqueue, claimJob, finishJob } from '../src/lib/foundation/store';
import { reviewResearch, listReviews } from '../src/lib/integrations/review-store';
import { defaultProfile } from '../src/lib/foundation/contracts';
import type { Workspace as WorkspaceData } from '../src/lib/foundation/contracts';

const owner = '550e8400-e29b-41d4-a716-446655440000';
const other = '550e8400-e29b-41d4-a716-446655440001';
const account = '550e8400-e29b-41d4-a716-446655440010';
const otherAccount = '550e8400-e29b-41d4-a716-446655440011';
const candidate = {key:'XNAS:TEST',ticker:'TEST',name:'Synthetic issuer',market:'us',exchange:'XNAS',
  issuer:{jurisdiction:'us',registryId:'0000000001'},identitySourceUrl:'https://data.sec.gov/fixture'};
const workspace: WorkspaceData = {version:1,profile:defaultProfile,candidates:[candidate]};
const payload = (jobId: string) => ({sourceResearchJobId:jobId,decision:'request_analysis',
  rationale:'The filing evidence warrants independent analysis.',confirmIssuerMapping:true,
  idempotencyKey:'550e8400-e29b-41d4-a716-446655440055'});
async function completedResearch(custom: WorkspaceData = workspace) {
  const enqueued = await enqueue(owner, {kind:'research',candidateKey:'XNAS:TEST',workspace:custom,
    idempotencyKey:crypto.randomUUID()});
  const job = (await claimJob())!;
  expect(job.id).toBe(enqueued.id);
  await finishJob(job,{kind:'research',report:{candidate:custom.candidates[0],approval:'human_review_required',
    financialAuthority:'FilingLens',screen:{finance:{status:'unavailable'}}}});
  return job.id;
}

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL','postgresql://test:test@localhost/test');
  state.db = new PGlite();
  await state.db.exec(readFileSync('migrations/001_foundation.sql','utf8'));
  await state.db.exec(readFileSync('migrations/002_gpi_integration.sql','utf8'));
  await state.db.exec(readFileSync('migrations/002_gpi_integration.sql','utf8'));
  await state.db.query("INSERT INTO users(id,email,display_name,password_hash) VALUES ($1,$2,'One','test'),($3,$4,'Two','test')",
    [owner,'owner@example.test',other,'other@example.test']);
  await state.db.query("INSERT INTO accounts(id,name,owner_user_id) VALUES ($1,'Owner',$2),($3,'Other',$4)",
    [account,owner,otherAccount,other]);
},30_000);
beforeEach(async () => {
  await state.db!.exec('TRUNCATE gpi_integration_outbox, gpi_integration_reviews, gpi_foundation_jobs');
});
afterAll(async()=>{await state.db?.close();vi.unstubAllEnvs();});
describe('durable GPI research review handoffs',()=>{
  it('requires completed account-owned research',async()=>{
    await expect(reviewResearch(owner,account,owner,payload(crypto.randomUUID()))).rejects.toThrow('research_not_ready');
  });
  it('saves human review and one event atomically, without external delivery',async()=>{
    const id=await completedResearch();const value=await reviewResearch(owner,account,owner,payload(id));
    expect(value.delivered).toBe(false);expect(value.review.issuer?.verification).toBe('analyst_confirmed');
    expect((await listReviews(owner))).toHaveLength(1);expect(await listReviews(other)).toHaveLength(0);
    const events=await state.db!.query('SELECT event,delivery_status,attempt_count FROM gpi_integration_outbox');
    expect(events.rows).toHaveLength(1);
    const firstEvent = events.rows[0] as {delivery_status: string; event: {eventType: string}};
    expect(firstEvent.delivery_status).toBe('pending');
    expect(firstEvent.event.eventType).toBe('candidate.reviewed.v1');
  });
  it('reuses idempotency keys and rejects changed requests',async()=>{
    const id=await completedResearch();const request=payload(id);
    const first=await reviewResearch(owner,account,owner,request);
    const second=await reviewResearch(owner,account,owner,request);
    expect(second.reused).toBe(true);expect(second.review.reviewId).toBe(first.review.reviewId);
    await expect(reviewResearch(owner,account,owner,{...request,decision:'reject'})).rejects.toThrow('idempotency_conflict');
    expect((await state.db!.query('SELECT event_id FROM gpi_integration_outbox')).rows).toHaveLength(1);
  });
  it('blocks unverified or unmapped analysis handoffs; permits watchlisting',async()=>{
    const id=await completedResearch({...workspace,candidates:[{...candidate,issuer:null}]});
    await expect(reviewResearch(owner,account,owner,payload(id))).rejects.toThrow('identity_not_confirmed');
    const watched=await reviewResearch(owner,account,owner,{...payload(id),decision:'watchlist',confirmIssuerMapping:false});
    expect(watched.review.issuer).toBeNull();expect(watched.review.evidenceStatus).toBe('unmapped');
  });
  it('prevents cross-account reuse of the same job ID',async()=>{
    const id=await completedResearch();
    await expect(reviewResearch(other,otherAccount,other,payload(id))).rejects.toThrow('research_not_ready');
  });
});
