import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import postgres from 'postgres';
import type { AuthContext } from '../src/lib/auth';
import { sql, closeStore } from '../src/lib/foundation/store';
import { advertiseBrowserWorker, claimRun, createRun, locked, readRun, reapRuns, retainObservation, submit } from '../src/lib/browser/store';

// Deliberately restricted to a disposable loopback database, never a Railway DB.
const mode = process.argv[2];
if (mode === 'claim' || mode === 'hold') {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname.startsWith('/gpi_browser_canary_'));
  try {
    if (mode === 'claim') process.send?.({id: (await claimRun(process.argv[3]))?.id ?? null});
    else await locked(process.argv[3], async () => {
      process.send?.({ready: true});
      await new Promise(() => {}); // Parent kills us while holding the row lock.
    });
  } finally { await closeStore(); }
} else {
  const adminUrl = new URL(process.env.BROWSER_POSTGRES_TEST_URL ?? '');
  assert.ok(['127.0.0.1', 'localhost'].includes(adminUrl.hostname), 'Only disposable loopback PostgreSQL is allowed');
  const name = 'gpi_browser_canary_' + randomUUID().replaceAll('-', '');
  const admin = postgres(adminUrl.href, {max: 1});
  let created = false;
  const children = new Set<ReturnType<typeof fork>>();
  const child = (action: string, id?: string) => {
    const p = fork(new URL(import.meta.url), [action, ...(id ? [id] : [])], {stdio: ['ignore', 'ignore', 'inherit', 'ipc']});
    children.add(p);p.once('exit', () => children.delete(p));
    return p;
  };
  try {
    await admin.unsafe(`CREATE DATABASE ${name}`);created = true;
    const testUrl = new URL(adminUrl);testUrl.pathname = '/' + name;
    process.env.DATABASE_URL = testUrl.href;
    for (const migration of ['005_browser_workspace.sql', '006_browser_capacity.sql']) {
      await sql().unsafe(await readFile(new URL('../migrations/' + migration, import.meta.url), 'utf8'));
    }
    const auth = (): AuthContext => ({userId: randomUUID(), actorUserId: randomUUID(), sessionId: randomUUID(), accountId: randomUUID(),
      email: 'synthetic@example.invalid', displayName: 'Canary', role: 'owner', isPlatformAdmin: false, accountName: 'Canary', accountType: 'personal'});
    const input = () => ({company: 'Canary', year: 2025, question: 'Find the report evidence', sourceUrl: 'https://fixture.gpi.invalid/', idempotencyKey: randomUUID(), mode: 'fixture' as const});
    const worker=randomUUID();await advertiseBrowserWorker(worker, true);
    const admissions = await Promise.allSettled(Array.from({length: 6}, () => createRun(auth(), input(), 'us:0000000001', 'Canary')));
    const accepted = admissions.filter(r => r.status === 'fulfilled');
    assert.equal(accepted.length, 1, 'One ready slot must admit exactly one run under contention');
    assert.ok(admissions.filter(r => r.status === 'rejected').every(r => r.reason.message === 'browser_capacity_unavailable'));
    const run = accepted[0].value;
    const claims = await Promise.all(Array.from({length: 2}, async () => {
      const p = child('claim',worker);const [message] = await once(p, 'message', {signal: AbortSignal.timeout(15_000)});
      const [code] = await once(p, 'exit');assert.equal(code, 0);return message.id;
    }));
    assert.equal(claims.filter(Boolean).length, 1, 'Two processes must claim a queued run only once');
    assert.equal(claims.find(Boolean), run.id);
    assert.equal((await sql()`SELECT busy FROM gpi_browser_workers WHERE id=${worker}`)[0].busy,true);
    await assert.rejects(createRun(auth(),input(),'us:0000000001','Canary'),/browser_capacity_unavailable/);
    assert.equal((await readRun(run.owner,run.id))?.state,'running');
    const command = randomUUID();
    const operator = {...auth(), userId:run.owner,actorUserId:run.actor,sessionId:run.authSession,accountId:run.accountId};
    const pause = {id:command,kind:'pause',epoch:0};
    await submit(operator,run.id,pause);await submit(operator,run.id,pause);
    assert.equal((await sql()`SELECT count(*)::int AS n FROM gpi_browser_commands WHERE id=${command}`)[0].n,1);
    await sql()`UPDATE gpi_browser_commands SET status='claimed' WHERE id=${command}`;
    await locked(run.id,async(r,tx)=>retainObservation(tx,r,{id:randomUUID(),tabId:randomUUID(),capturedAt:new Date().toISOString(),
      url:run.input.sourceUrl,title:'Synthetic',text:'Synthetic observation',links:[],width:1200,height:800,image:''}));
    for (const table of ['gpi_browser_sessions','gpi_browser_commands','gpi_browser_events','gpi_browser_observations']) {
      const rows = await sql().unsafe(`SELECT jsonb_typeof(payload) AS kind FROM ${table}`);
      assert.ok(rows.length>0&&rows.every(r=>r.kind==='object'),`${table} must persist JSON objects`);
      await sql().unsafe(`UPDATE ${table} SET payload=to_jsonb(payload::text)`);
    }
    const repair=await readFile(new URL('../migrations/006_browser_capacity.sql',import.meta.url),'utf8');
    await sql().unsafe(repair);await sql().unsafe(repair);
    for (const table of ['gpi_browser_sessions','gpi_browser_commands','gpi_browser_events','gpi_browser_observations']) {
      assert.ok((await sql().unsafe(`SELECT jsonb_typeof(payload) AS kind FROM ${table}`)).every(r=>r.kind==='object'));
    }
    const holder = child('hold', run.id);
    await once(holder, 'message', {signal: AbortSignal.timeout(15_000)});
    const exited = once(holder, 'exit');holder.kill('SIGKILL');await exited;
    await locked(run.id, async r => {r.leaseUntil = 0;});
    await reapRuns();
    assert.equal((await readRun(run.owner, run.id))?.state, 'reconciling');
    assert.equal(await claimRun(randomUUID()), null, 'Unknown work must never be reclaimed');
    assert.equal((await sql()`SELECT status FROM gpi_browser_commands WHERE id=${command}`)[0].status, 'claimed');
    console.log(JSON.stringify({kind: 'native-postgres-browser-concurrency', success: true,
      competingAdmissions: 6, accepted: 1, competingProcesses: 2, claims: 1, killedLockHolder: true, uncertainCommandReplayed: false}));
  } finally {
    for (const p of children) p.kill('SIGKILL');
    await closeStore();
    if (created) await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  }
}
