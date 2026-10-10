import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { getDatabaseUrl } from '../env';
import { defaultProfile, JobRequest, Workspace } from './contracts';
import type { JobRequest as JobInput } from './contracts';
import seed from '../../../data/usa-cvm-universe.json';

let connection: ReturnType<typeof postgres> | undefined;
export function sql() { return connection ??= postgres(getDatabaseUrl(), { max: 4, idle_timeout: 20, connect_timeout: 10 }); }
export async function closeStore() { if (connection) await connection.end({ timeout: 5 }); }
export type JobRow = { id: string; owner_id: string; kind: 'screen' | 'research'; status: 'queued' | 'running' | 'complete' | 'failed';
  input: JobInput; output: unknown; error_code: string | null; created_at: string; finished_at: string | null; lease_token: string | null };

export async function loadWorkspace(owner: string) {
  const rows = await sql()`SELECT payload FROM gpi_foundation_workspaces WHERE owner_id = ${owner}`;
  return Workspace.parse(rows[0]?.payload ?? { version: 1, profile: defaultProfile, candidates: seed.candidates });
}
export async function saveWorkspace(owner: string, value: unknown) {
  const parsed = Workspace.parse(value);
  await sql()`INSERT INTO gpi_foundation_workspaces (owner_id,payload) VALUES (${owner},${sql().json(parsed)})
    ON CONFLICT (owner_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`;
  return parsed;
}
export async function listJobs(owner: string) {
  return await sql()<JobRow[]>`SELECT id,owner_id,kind,status,output,error_code,created_at,finished_at FROM gpi_foundation_jobs
    WHERE owner_id = ${owner} ORDER BY created_at DESC LIMIT 30`;
}
export class QueueError extends Error { constructor(readonly code: 'idempotency_conflict' | 'queue_limit' | 'daily_limit') { super(code); } }
export async function enqueue(owner: string, value: unknown) {
  const input = JobRequest.parse(value);
  const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return sql().begin(async tx => {
    // Serializes quota/idempotency checks across every dashboard replica for this account.
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${owner},0))`;
    const existing = await tx`SELECT id,status,request_hash FROM gpi_foundation_jobs WHERE owner_id=${owner} AND idempotency_key=${input.idempotencyKey}`;
    if (existing[0]) {
      if (existing[0].request_hash !== requestHash) throw new QueueError('idempotency_conflict');
      return { id: existing[0].id as string, status: existing[0].status as string, reused: true };
    }
    const pending = await tx`SELECT count(*)::int AS n FROM gpi_foundation_jobs WHERE owner_id=${owner} AND status IN ('queued','running')`;
    if (pending[0].n >= 3) throw new QueueError('queue_limit');
    const daily = await tx`SELECT count(*)::int AS n FROM gpi_foundation_jobs WHERE owner_id=${owner} AND created_at > now()-interval '24 hours'`;
    if (daily[0].n >= 25) throw new QueueError('daily_limit');
    const id = randomUUID();
    await tx`INSERT INTO gpi_foundation_jobs (id,owner_id,kind,idempotency_key,request_hash,input)
      VALUES (${id},${owner},${input.kind},${input.idempotencyKey},${requestHash},${tx.json(input)})`;
    return { id, status: 'queued', reused: false };
  });
}
export async function claimJob(): Promise<JobRow | null> {
  const token = randomUUID();
  // Expired work is failed, not replayed: a model request may already have been charged.
  await sql()`UPDATE gpi_foundation_jobs SET status='failed',error_code='worker_lease_expired',finished_at=now()
    WHERE status='running' AND lease_until < now()`;
  await sql()`UPDATE gpi_foundation_jobs SET status='failed',error_code='queue_wait_expired',finished_at=now()
    WHERE status='queued' AND created_at < now()-interval '1 hour'`;
  const rows = await sql()<JobRow[]>`UPDATE gpi_foundation_jobs SET status='running',started_at=now(),
    lease_until=now()+interval '180 seconds',lease_token=${token}
    WHERE id=(SELECT id FROM gpi_foundation_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *`;
  return rows[0] ?? null;
}
export async function finishJob(job: JobRow, output: unknown, errorCode: string | null = null) {
  const rows = await sql()`UPDATE gpi_foundation_jobs SET status=${errorCode ? 'failed' : 'complete'},
    output=${output === null ? null : sql().json(output as postgres.JSONValue)},error_code=${errorCode},finished_at=now(),lease_until=null
    WHERE id=${job.id} AND status='running' AND lease_token=${job.lease_token} AND lease_until > now() RETURNING id`;
  return rows.length === 1; // Fences stale workers from overwriting a newer terminal state.
}
