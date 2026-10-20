import { setTimeout as delay } from 'node:timers/promises';
import { claimJob, closeStore, finishJob } from '../src/lib/foundation/store';
import { executeJob } from '../src/lib/foundation/runner';
import { reapRuns } from '../src/lib/browser/store';
import { superviseBrowserRuntime } from '../src/lib/browser/runtime-supervisor';
import {processHistory} from '../src/lib/market/history-store';
import {checkIntegrations} from './check-integrations';

let stopping = false;
let reaping=false;
let historyRunning:Promise<void>|undefined;
const historyTimer=setInterval(()=>{
  if(stopping||historyRunning)return;
  historyRunning=processHistory().catch(()=>console.error(JSON.stringify({kind:'market_history',status:'store_unavailable'}))).finally(()=>{historyRunning=undefined;});
},5000);
const runtimeStop=new AbortController();
if(process.env.INTEGRATION_STARTUP_CHECK==='true')void checkIntegrations().catch(()=>console.error(JSON.stringify({kind:'integration_check',status:'unavailable'})));
const runtimeTask=process.env.BROWSER_RUNTIME_ENABLED==='true'
  ?superviseBrowserRuntime(runtimeStop.signal).catch(()=>console.error(JSON.stringify({status:'browser_runtime_unavailable_check_configuration'})))
  :Promise.resolve();
// Independent of browser execution: a browser worker crash cannot suspend expiry.
const browserReaper=setInterval(()=>{
  if(reaping||![process.env.BROWSER_WORKSPACE_ENABLED,process.env.BROWSER_VERIFICATION_ENABLED,process.env.BROWSER_RUNTIME_ENABLED].includes('true'))return;
  reaping=true;void reapRuns().catch(()=>console.error(JSON.stringify({status:'browser_reaper_unavailable'}))).finally(()=>{reaping=false;});
},10_000);
process.on('SIGTERM', () => { stopping = true;runtimeStop.abort(); });
process.on('SIGINT', () => { stopping = true;runtimeStop.abort(); });
try {
  while (!stopping) {
    try {
      const job = await claimJob();
      if (!job) { await delay(2000); continue; }
      try {
        const output = await executeJob(job.input,undefined,undefined,undefined,job.owner_id);
        const saved = await finishJob(job, output);
        console.log(JSON.stringify({ runId: job.id, status: saved ? 'complete' : 'lease_lost', elapsedMs: output.trace.elapsedMs, stopReason: output.stopReason }));
      } catch { await finishJob(job, null, 'run_failed'); console.error(JSON.stringify({ runId: job.id, status: 'failed' })); }
    } catch { console.error(JSON.stringify({ status: 'store_unavailable' })); await delay(5000); }
  }
} finally { clearInterval(browserReaper);clearInterval(historyTimer);runtimeStop.abort();await Promise.allSettled([runtimeTask,historyRunning]);await closeStore(); }
