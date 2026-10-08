import { randomUUID } from 'node:crypto';
import { callbackPayload, deliverCallback, nextCallbackTime } from './callback.js';
import { getWorkerConfig, stageReasoningEffort, workerHealthBudgets } from './config.js';
import { OpenAIAgenticPipeline } from './openai-pipeline.js';
import { PostgresJobRepository } from './postgres-repository.js';
import { processJob } from './process-job.js';
import { createWorkerHealthServer, type WorkerHeartbeat, type WorkerState } from './worker-health.js';
import { keepJobLeaseAlive } from './worker-lease.js';
import { loadFinanceRuntime, type FinanceRuntime } from './finance-startup.js';
import type { QueueTelemetry } from './types.js';

const config = getWorkerConfig();
const repository = new PostgresJobRepository(config.AGENTIC_DATABASE_URL);
/** Generic pipeline is now used only for extraction, discovery and market briefs. */
const pipeline = new OpenAIAgenticPipeline(
  config.OPENAI_API_KEY,
  config.OPENAI_MODEL,
  stageReasoningEffort(config),
  undefined,
  { provider: config.WEB_SEARCH_PROVIDER, apiKey: config.WEB_SEARCH_API_KEY },
  { maritacaApiKey: config.MARITACA_API_KEY, maritacaModel: config.MARITACA_DATA_MODEL,
    brapiApiKey: config.BRAPI_API_KEY, secUserAgent: config.SEC_USER_AGENT }
);
const workerId = `worker-${randomUUID()}`;
/** The bundled finance runtime is the sole security-analysis orchestrator. */
let financeRuntime: FinanceRuntime | null = null;
let stopping = false;

// The healthcheck reads these; the loop is the only writer.
let state: WorkerState = 'starting';
let lastPollAt: number | null = null;
let jobsProcessed = 0;
const workerStartedAt = Date.now();
let accumulatedBusyMs = 0;
let busyStartedAt: number | null = null;
let canonicalQueue: QueueTelemetry | null = null;
let preparatoryQueue: QueueTelemetry | null = null;
let nextTelemetryAt = 0;

function setState(next: WorkerState): void {
  const now = Date.now();
  if (next === 'processing' && busyStartedAt === null) busyStartedAt = now;
  if (next !== 'processing' && busyStartedAt !== null) {
    accumulatedBusyMs += now - busyStartedAt;
    busyStartedAt = null;
  }
  state = next;
}

function busyRatio(now = Date.now()): number {
  const current = busyStartedAt === null ? 0 : now - busyStartedAt;
  return Math.min(1, (accumulatedBusyMs + current) / Math.max(1, now - workerStartedAt));
}

const heartbeat = (): WorkerHeartbeat => ({
  state,
  lastPollAt,
  jobsProcessed,
  busyRatio: busyRatio(),
  canonicalQueue,
  preparatoryQueue,
});
const healthServer = createWorkerHealthServer({
  workerId,
  heartbeat,
  ...workerHealthBudgets(config),
});

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function deliverNextCallback(): Promise<boolean> {
  const job = await repository.claimCallback();
  if (!job) return false;
  try {
    await deliverCallback(
      config.DASHBOARD_IMPORT_URL,
      config.AGENTIC_SYSTEM_API_KEY,
      callbackPayload(job, config.AGENTIC_INTERNAL_BASE_URL)
    );
    await repository.markCallbackDelivered(job.id);
  } catch (error) {
    const permanent = job.callbackAttempts >= config.AGENTIC_CALLBACK_MAX_ATTEMPTS;
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Dashboard callback failed';
    await repository.scheduleCallbackRetry(
      job.id,
      message,
      nextCallbackTime(job.callbackAttempts),
      permanent
    );
  }
  return true;
}

async function refreshQueueTelemetry(): Promise<void> {
  const now = Date.now();
  if (now < nextTelemetryAt) return;
  nextTelemetryAt = now + config.AGENTIC_TELEMETRY_POLL_MS;
  const [canonical, preparatory] = await Promise.allSettled([
    financeRuntime?.getResearchQueueTelemetry() ?? Promise.resolve(null),
    repository.queueTelemetry(),
  ]);
  if (canonical.status === 'fulfilled') canonicalQueue = canonical.value;
  else process.stderr.write(`Canonical queue telemetry unavailable: ${canonical.reason instanceof Error ? canonical.reason.message : String(canonical.reason)}\n`);
  if (preparatory.status === 'fulfilled') preparatoryQueue = preparatory.value;
  else process.stderr.write(`Preparatory queue telemetry unavailable: ${preparatory.reason instanceof Error ? preparatory.reason.message : String(preparatory.reason)}\n`);
}

function closeHealthServer(): Promise<void> {
  return new Promise((resolve) => healthServer.close(() => resolve()));
}

async function run(): Promise<void> {
  await repository.ping();
  financeRuntime = await loadFinanceRuntime(
    config.FINANCE_DATABASE_URL,
    () => import('./finance-runtime.js')
  );
  process.stdout.write(financeRuntime
    ? 'Canonical finance runtime ready: configuration and research queue verified\n'
    : 'Canonical finance runtime disabled in local preparatory-only mode\n');
  await new Promise<void>((resolve, reject) => {
    const failedToBind = (error: Error) => reject(error);
    healthServer.once('error', failedToBind);
    healthServer.listen(config.PORT, '0.0.0.0', () => {
      healthServer.off('error', failedToBind);
      healthServer.on('error', (error: Error) => {
        process.stderr.write(`Worker liveness server error: ${error.message}\n`);
      });
      resolve();
    });
  });
  process.stdout.write(
    `Agentic worker ${workerId} ready with model ${config.OPENAI_MODEL}, liveness on 0.0.0.0:${config.PORT}/health\n`
  );
  while (!stopping) {
    // Recorded before the work, not after, so a job that never returns shows up
    // as a stalled worker instead of freezing the last healthy timestamp.
    lastPollAt = Date.now();
    setState('idle');
    await refreshQueueTelemetry();
    if (await deliverNextCallback()) continue;
    if (financeRuntime) {
      setState('processing');
      const processed = await financeRuntime.processQueuedSessions(() => {
        lastPollAt = Date.now();
      });
      lastPollAt = Date.now();
      setState('idle');
      jobsProcessed += processed;
      if (processed > 0) nextTelemetryAt = 0;
    }
    const job = await repository.claimNext(workerId, config.AGENTIC_JOB_LEASE_SECONDS);
    if (job) {
      process.stdout.write(`Processing ${job.kind} ${job.externalId}\n`);
      setState('processing');
      const lease = keepJobLeaseAlive(repository, job.id, workerId, config.AGENTIC_JOB_LEASE_SECONDS, () => {
        lastPollAt = Date.now();
      });
      try {
        await processJob(job, { repository, pipeline });
      } finally {
        await lease.stop();
        if (lease.lost) {
          throw new Error(`Worker lost its lease while processing ${job.externalId}`);
        }
        setState('idle');
        jobsProcessed += 1;
        nextTelemetryAt = 0;
      }
      continue;
    }
    await delay(config.AGENTIC_WORKER_POLL_MS);
  }
  await closeHealthServer();
  await repository.close();
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

run().catch(async (error: unknown) => {
  process.stderr.write(`Agentic worker stopped: ${error instanceof Error ? error.message : String(error)}\n`);
  // Without this the listening socket would keep the event loop alive and the
  // process would hang instead of exiting non-zero for Railway to restart.
  await closeHealthServer();
  await repository.close().catch(() => undefined);
  process.exitCode = 1;
});
