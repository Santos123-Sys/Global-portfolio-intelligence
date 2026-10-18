import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({commands:[] as string[],options:null as Record<string,unknown>|null}));
vi.mock('railway',()=>{
  const recipe={withPackages:()=>recipe,run:(cmd:string)=>{state.commands.push(cmd);return recipe;},build:async()=>recipe};
  return {Sandbox:{template:()=>recipe,create:vi.fn(async(_recipe,options)=>{state.options=options;return {id:'synthetic-vm'};})},SandboxNotFoundError:class extends Error{}};
});
import {RailwayBrowserRuntime,railwayRuntimeConfig} from '../src/lib/browser/railway-runtime';
beforeEach(()=>{state.commands=[];state.options=null;});
it('pins public source and passes only necessary service references to the VM, never its control-plane token',async()=>{
  const release='a'.repeat(40),config=railwayRuntimeConfig({BROWSER_RUNTIME_RAILWAY_TOKEN:'synthetic-control-secret',
    RAILWAY_ENVIRONMENT_ID:'550e8400-e29b-41d4-a716-446655440000',BROWSER_RUNTIME_RELEASE_SHA:release,
    BROWSER_SOURCE_ORIGINS:'https://www.sec.gov'});
  const runtime=new RailwayBrowserRuntime(config);await runtime.prepare(release);await runtime.create('synthetic-generation');
  expect(state.commands.some(c=>c.includes('git checkout --detach '+release))).toBe(true);
  expect(state.commands.some(c=>c.includes('NODE_ENV=production')&&c.includes('verify-browser-engine.ts'))).toBe(true);
  expect(state.commands.join('\n')).not.toContain('synthetic-control-secret');
  const options=state.options!;expect(options.networkIsolation).toBe('PRIVATE');expect(options.domains).toBeUndefined();
  const env=options.env as Record<string,string>;
  expect(Object.keys(env).sort()).toEqual(['BROWSER_RUNTIME_GENERATION','BROWSER_SOURCE_ORIGINS','DATABASE_URL','NODE_ENV',
    'PLAYWRIGHT_BROWSERS_PATH','RESEARCH_MODEL_API_KEY','RESEARCH_MODEL_NAME'].sort());
  expect(env.DATABASE_URL).toBe('${{agentic-worker.DATABASE_URL}}');
  expect(JSON.stringify(env)).not.toContain('synthetic-control-secret');
});
it('rejects unpinned code, missing dedicated authentication and injectable service reference names',()=>{
  const env={BROWSER_RUNTIME_RAILWAY_TOKEN:'synthetic-token',RAILWAY_ENVIRONMENT_ID:'550e8400-e29b-41d4-a716-446655440000',BROWSER_RUNTIME_RELEASE_SHA:'a'.repeat(40)};
  expect(()=>railwayRuntimeConfig({...env,BROWSER_RUNTIME_RELEASE_SHA:'main; env'})).toThrow();
  expect(()=>railwayRuntimeConfig({...env,BROWSER_RUNTIME_RAILWAY_TOKEN:undefined})).toThrow();
  expect(()=>railwayRuntimeConfig({...env,BROWSER_RUNTIME_VARIABLE_SERVICE:'worker}} $TOKEN'})).toThrow();
});
