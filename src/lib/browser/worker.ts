import { randomUUID } from 'node:crypto';
import { sql } from '../foundation/store';
import { Command, terminal, type BrowserRun, type Action } from './contracts';
import { ResearchBrowser,captureEvidence,FIXTURE_ORIGIN } from './engine';
import { configuredOrigins } from './policy';
import { checkBudget,propose } from './operator';
import type { ModelCall } from '../research/manager';
import { activeAuthority,advertiseBrowserWorker,claimRun,event,locked,reapRuns,retainObservation } from './store';

const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export async function executeBrowserRun(initial:BrowserRun,shutdown:AbortSignal,dependencies:{engine?:ResearchBrowser;model?:ModelCall}={}) {
  const engine=dependencies.engine??new ResearchBrowser(initial.input.mode==='fixture'?[FIXTURE_ORIGIN]:configuredOrigins(),initial.input.mode==='fixture');
  const lifetime=setTimeout(()=>void engine.close(),Math.max(1,initial.expiresAt-Date.now()));
  let modelAbort:AbortController|null=null;
  let modelTask:Promise<void>|null=null;
  let finished=false;
  const closeOnAbort=()=>{modelAbort?.abort();void engine.close();};
  shutdown.addEventListener('abort',closeOnAbort,{once:true});
  async function dispatch(expected:BrowserRun,action:Action,actionId:string) {
    await locked(initial.id,async(run,tx)=>{
      if(run.worker!==initial.worker||run.epoch!==expected.epoch||terminal(run.state)||!['running','human'].includes(run.state))throw Error('dispatch_revoked');
      if(!await activeAuthority(run,tx))throw Error('authority_revoked');
      checkBudget(run);
      if(run.observation?.id!==expected.observation?.id)throw Error('stale_observation');
      await event(tx,run,'action_dispatched',`Executing ${action.kind}`,{actionId,observationId:run.observation?.id,action});
    });
    // A second fence closes the proposal/dispatch race. Takeover waits for this short
    // transaction to finish; unknown outcomes after process loss are never replayed.
    await locked(initial.id,async(run,tx)=>{
      if(run.worker!==initial.worker||run.epoch!==expected.epoch||!['running','human'].includes(run.state)||!await activeAuthority(run,tx))throw Error('dispatch_revoked');
      const observation=run.observation!;
      const next=await engine.execute(action,observation.id);run.actions++;
      if(action.kind==='capture'){
        run.evidence.push(captureEvidence(observation,action.quote,{issuerId:run.issuerId,year:run.input.year,originalUrl:run.input.sourceUrl},actionId));
      }
      if(action.kind==='finish'){run.state=run.evidence.length?'completed':'partial';run.reason=run.evidence.length?'exact_excerpt_retained_requires_review':'no_evidence';}
      if(next.id!==observation.id)await retainObservation(tx,run,next);
      await event(tx,run,'action_completed',action.kind==='capture'?'Exact passage retained; issuer/year remain subject to review':`${action.kind} completed`,{actionId,observationId:observation.id,action});
      run.leaseUntil=Date.now()+30_000;
    });
  }
  try {
    // Starting checks precede network access.
    await locked(initial.id,async(run,tx)=>{if(!await activeAuthority(run,tx)||run.state!=='running')throw Error('authority_revoked');});
    const first=await engine.open(initial.input.sourceUrl);
    await locked(initial.id,async(run,tx)=>{await retainObservation(tx,run,first);await event(tx,run,'observed','Public page observed',{observationId:first.id});});
    while(!shutdown.aborted&&!finished){
      const snapshot=await locked(initial.id,async(run,tx)=>{
        if(run.worker!==initial.worker||terminal(run.state)){finished=true;return run;}
        if(run.expiresAt<Date.now()||!await activeAuthority(run,tx)){run.state='cancelling';run.reason='authority_or_lifetime_expired';}
        if(run.state==='cancelling'){
          modelAbort?.abort();await engine.close();run.state='cancelled';run.controller=null;
          await event(tx,run,'cancelled','Browser closed; completed evidence retained');finished=true;return run;
        }
        run.leaseUntil=Date.now()+30_000;return run;
      });
      if(finished)break;
      const frame=await engine.frame();
      if(frame)await locked(initial.id,async run=>{if(!terminal(run.state)&&run.observation?.id===frame.observationId)run.frame=frame;});
      const pending=await sql()`SELECT id,payload,actor_id FROM gpi_browser_commands WHERE session_id=${initial.id} AND status='pending' ORDER BY created_at,id LIMIT 1`;
      if(pending[0]){
        const command=Command.parse(pending[0].payload);
        // Claim durably before effects; never replay a claimed command after a crash.
        await sql()`UPDATE gpi_browser_commands SET status='claimed' WHERE session_id=${initial.id} AND id=${command.id} AND status='pending'`;
        if(command.kind==='input'){
          try{await dispatch(snapshot,command.action!,command.id);}catch{
            await locked(initial.id,async(run,tx)=>{await event(tx,run,'input_rejected','Input rejected or outcome uncertain; reobserve before retry',{actionId:command.id});run.state='paused';run.controller=null;run.epoch++;});
          }
        }else{
          modelAbort?.abort();
          await locked(initial.id,async(run,tx)=>{
            if(terminal(run.state)||run.state==='cancelling')return;
            // Reobserve before control changes and invalidate every late model answer.
            await retainObservation(tx,run,await engine.observe());
            run.state=command.kind==='takeover'?'human':command.kind==='resume'?'running':'paused';
            run.controller=command.kind==='takeover'?pending[0].actor_id:null;
            await event(tx,run,'control_acknowledged',run.state==='human'?'Exclusive human control granted':run.state==='running'?'Agent resumed after fresh observation':'Agent paused');
          });
        }
        await sql()`UPDATE gpi_browser_commands SET status='completed' WHERE session_id=${initial.id} AND id=${command.id}`;
      }else if(snapshot.state==='running'&&!modelTask){
        checkBudget(snapshot);modelAbort=new AbortController();
        const signal=AbortSignal.any([modelAbort.signal,shutdown,AbortSignal.timeout(25_000)]);
        const expected=await locked(initial.id,async(run,tx)=>{
          if(run.state!=='running')return null;
          run.calls++;await event(tx,run,'model_observation',run.input.mode==='fixture'?'Deterministic fixture decision':'DOM observation supplied to AI operator',{observationId:run.observation!.id});return run;
        });
        if(expected){
          modelTask=(async()=>{
            try {
              const result=await propose(expected,expected.observation!,signal,dependencies.model);
              if(signal.aborted)return;
              await locked(initial.id,async(run,tx)=>{run.tokens+=result.tokens;await event(tx,run,'action_proposed',`${result.action.kind} proposed`,{observationId:expected.observation!.id});});
              await dispatch(expected,result.action,randomUUID());
            }catch{
              if(!signal.aborted)await locked(initial.id,async(run,tx)=>{
                if(run.epoch!==expected.epoch||run.state!=='running')return;
                run.state=run.evidence.length?'partial':'failed';run.reason='operator_or_source_failed';
                await event(tx,run,'failed','Operator stopped; provider, policy or source validation failed. No action replay.');
              });
            }
          })().finally(()=>{modelTask=null;});
        }
      }
      await wait(350);
    }
  } catch {
    await locked(initial.id,async(run,tx)=>{if(!terminal(run.state)){run.state=run.evidence.length?'partial':'failed';run.reason='browser_execution_failed';await event(tx,run,'failed','Browser stopped; useful evidence retained, no automatic replay.');}});
  } finally {
    modelAbort?.abort();await modelTask;clearTimeout(lifetime);shutdown.removeEventListener('abort',closeOnAbort);await engine.close();
    if(shutdown.aborted)await locked(initial.id,async(run,tx)=>{if(!terminal(run.state)){run.state='cancelled';run.controller=null;run.epoch++;await event(tx,run,'cancelled','Worker shutdown acknowledged; browser closed');}});
  }
}
export async function browserWorker(signal:AbortSignal) {
  const worker=randomUUID();
  if(!process.env.RESEARCH_MODEL_API_KEY||!process.env.RESEARCH_MODEL_NAME)throw Error('research_model_unconfigured');
  // Direct worker starts must prove isolation too, not only browser-service starts.
  const probe=new ResearchBrowser([FIXTURE_ORIGIN],true);
  try { await probe.open(FIXTURE_ORIGIN+'/'); } finally { await probe.close(); }
  try {
    while(!signal.aborted){
      await reapRuns();await advertiseBrowserWorker(worker,true);
      const run=await claimRun(worker);
      if(run)await executeBrowserRun(run,signal);else await wait(1000);
    }
  } finally { await advertiseBrowserWorker(worker,false); }
}
