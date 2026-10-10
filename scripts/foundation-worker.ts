import { setTimeout as delay } from 'node:timers/promises';
import { claimJob, closeStore, finishJob } from '../src/lib/foundation/store';
import { executeJob } from '../src/lib/foundation/runner';

let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
try {
  while (!stopping) {
    try {
      const job = await claimJob();
      if (!job) { await delay(2000); continue; }
      try {
        const output = await executeJob(job.input);
        const saved = await finishJob(job, output);
        console.log(JSON.stringify({ runId: job.id, status: saved ? 'complete' : 'lease_lost', elapsedMs: output.trace.elapsedMs, stopReason: output.stopReason }));
      } catch { await finishJob(job, null, 'run_failed'); console.error(JSON.stringify({ runId: job.id, status: 'failed' })); }
    } catch { console.error(JSON.stringify({ status: 'store_unavailable' })); await delay(5000); }
  }
} finally { await closeStore(); }
