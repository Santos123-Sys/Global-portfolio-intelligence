import { describe,it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runtimeTick,type RuntimeProvider } from '../src/lib/browser/runtime-controller';
import type { RuntimeState } from '../src/lib/browser/runtime-store';

const release='a'.repeat(40),now=Date.now();
function harness(patch:Partial<RuntimeState>={}){
  let held=true;
  const state:RuntimeState={generation:randomUUID(),phase:'idle',vmId:null,session:null,release,reason:null,
    attempts:0,windowStarted:now,changedAt:now,retryAt:0,...patch};
  const provider:RuntimeProvider={prepare:vi.fn(async()=>{}),create:vi.fn(async()=>'vm-one'),start:vi.fn(async()=>'worker-session'),
    running:vi.fn(async()=>true),destroy:vi.fn(async()=>{})};
  const repo={mutate:vi.fn(async(fn:(s:RuntimeState)=>void)=>{if(!held)throw Error('runtime_lease_lost');fn(state);return structuredClone(state);}),
    healthy:vi.fn(async()=>true),reconcile:vi.fn(async()=>{})};
  return {state,provider,repo,lose:()=>{held=false;},tick:()=>runtimeTick(structuredClone(state),release,provider,repo,now)};
}
describe('leased browser VM recovery',()=>{
  it('preflights a pinned recipe before creating and starts admission only after a fresh worker heartbeat',async()=>{
    const h=harness();await h.tick();expect(h.state.phase).toBe('starting');expect(h.state.session).toBe('worker-session');
    expect(h.provider.prepare).toHaveBeenCalledWith(release);await h.tick();expect(h.state.phase).toBe('ready');
  });
  it('withdraws admission after worker loss, destroys first, reconciles and then permits replacement',async()=>{
    const h=harness({phase:'ready',vmId:'old-vm',session:'old-worker'});vi.mocked(h.provider.running).mockResolvedValue(false);
    await h.tick();expect(h.state.phase).toBe('recovering');expect(h.provider.create).not.toHaveBeenCalled();
    await h.tick();expect(h.provider.destroy).toHaveBeenCalledWith('old-vm');expect(h.repo.reconcile).toHaveBeenCalled();
    expect(h.state.vmId).toBeNull();expect(h.state.phase).toBe('idle');expect(h.state.retryAt).toBeGreaterThan(now);
  });
  it('does not create a replacement when VM destruction cannot be confirmed',async()=>{
    const h=harness({phase:'recovering',vmId:'old-vm'});vi.mocked(h.provider.destroy).mockRejectedValue(Error('unreachable'));
    await expect(h.tick()).rejects.toThrow();expect(h.state.vmId).toBe('old-vm');expect(h.repo.reconcile).not.toHaveBeenCalled();
    expect(h.provider.create).not.toHaveBeenCalled();
  });
  it('blocks a creation whose external outcome is unknown rather than provisioning again',async()=>{
    const h=harness();vi.mocked(h.provider.create).mockRejectedValue(Error('timeout'));
    await h.tick();expect(h.state.phase).toBe('blocked');expect(h.state.reason).toBe('creation_outcome_unknown');
    await h.tick();expect(h.provider.create).toHaveBeenCalledTimes(1);
  });
  it('recognizes a controller crash between creation intent and saved VM identity',async()=>{
    const h=harness({phase:'creating'});await h.tick();expect(h.state.phase).toBe('blocked');expect(h.provider.create).not.toHaveBeenCalled();
  });
  it('does not dispatch provider creation after losing its controller lease',async()=>{
    const h=harness();vi.mocked(h.provider.prepare).mockImplementation(async()=>h.lose());
    await expect(h.tick()).rejects.toThrow('runtime_lease_lost');expect(h.provider.create).not.toHaveBeenCalled();
  });
  it('destroys a newly created VM if authority disappears before its identity can be committed',async()=>{
    const h=harness();vi.mocked(h.provider.create).mockImplementation(async()=>{h.lose();return 'new-orphan';});
    await expect(h.tick()).rejects.toThrow('runtime_lease_lost');expect(h.provider.destroy).toHaveBeenCalledWith('new-orphan');
    expect(h.provider.start).not.toHaveBeenCalled();
  });
  it('destroys a VM after an uncertain start instead of running the command twice',async()=>{
    const h=harness();vi.mocked(h.provider.start).mockRejectedValue(Error('dropped'));
    await h.tick();expect(h.state.phase).toBe('recovering');await h.tick();expect(h.provider.start).toHaveBeenCalledTimes(1);
    expect(h.provider.destroy).toHaveBeenCalledWith('vm-one');
  });
  it('bounds automatic replacement cost and fails closed after build failure',async()=>{
    const capped=harness({attempts:3});await capped.tick();expect(capped.state.reason).toBe('hourly_replacement_budget');
    expect(capped.provider.prepare).not.toHaveBeenCalled();
    const bad=harness();vi.mocked(bad.provider.prepare).mockRejectedValue(Error('unsupported OS'));
    await bad.tick();expect(bad.state.reason).toBe('runtime_build_failed');expect(bad.provider.create).not.toHaveBeenCalled();
  });
  it('replaces a release through confirmed teardown and treats health uncertainty as unavailable',async()=>{
    const h=harness({phase:'ready',vmId:'old-vm',session:'session',release:'b'.repeat(40)});await h.tick();
    expect(h.provider.destroy).toHaveBeenCalledWith('old-vm');expect(h.provider.create).not.toHaveBeenCalled();
    const unknown=harness({phase:'ready',vmId:'vm',session:'session'});vi.mocked(unknown.provider.running).mockRejectedValue(Error('provider outage'));
    await unknown.tick();expect(unknown.state.phase).toBe('recovering');
  });
});
