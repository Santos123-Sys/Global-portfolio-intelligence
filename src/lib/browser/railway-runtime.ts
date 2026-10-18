import { Sandbox, SandboxNotFoundError } from 'railway';
import { z } from 'zod';
import type { RuntimeProvider } from './runtime-controller';

const Config=z.object({token:z.string().min(1),environmentId:z.string().uuid(),release:z.string().regex(/^[a-f0-9]{40}$/),
  service:z.string().regex(/^[a-zA-Z0-9_-]+$/),key:z.enum(['RESEARCH_MODEL_API_KEY','OPENAI_API_KEY']),
  model:z.enum(['RESEARCH_MODEL_NAME','OPENAI_MODEL']),origins:z.string(),authType:z.enum(['project-token','bearer'])});
export function railwayRuntimeConfig(env:Record<string,string|undefined>=process.env) {
  return Config.parse({token:env.BROWSER_RUNTIME_RAILWAY_TOKEN,environmentId:env.RAILWAY_ENVIRONMENT_ID,
    release:env.BROWSER_RUNTIME_RELEASE_SHA??env.RAILWAY_GIT_COMMIT_SHA,service:env.BROWSER_RUNTIME_VARIABLE_SERVICE??'agentic-worker',
    key:env.BROWSER_RUNTIME_MODEL_KEY_VARIABLE??'RESEARCH_MODEL_API_KEY',model:env.BROWSER_RUNTIME_MODEL_NAME_VARIABLE??'RESEARCH_MODEL_NAME',
    origins:env.BROWSER_SOURCE_ORIGINS??'',authType:env.BROWSER_RUNTIME_AUTH_TYPE??'bearer'});
}
export class RailwayBrowserRuntime implements RuntimeProvider {
  private template?:ReturnType<typeof Sandbox.template>;
  constructor(private config:ReturnType<typeof railwayRuntimeConfig>) {}
  private options(){return {token:this.config.token,authType:this.config.authType,environmentId:this.config.environmentId,
    endpoint:'https://backboard.railway.com/graphql/v2',verbose:false};}
  async prepare(release:string) {
    if(release!==this.config.release)throw Error('runtime_release_mismatch');
    const recipe=Sandbox.template()
      .withPackages('dumb-init','git','ca-certificates')
      .run('useradd --create-home browsercheck && install -m 755 "$(command -v node)" /usr/local/bin/gpi-node')
      .run(`git clone https://github.com/Santos123-Sys/Global-portfolio-intelligence.git /opt/gpi && cd /opt/gpi && git checkout --detach ${release} && npm ci --omit=dev --ignore-scripts`)
      .run('cd /opt/gpi && PLAYWRIGHT_BROWSERS_PATH=/opt/gpi-browsers npx playwright install --with-deps chromium')
      .run('cd /opt/gpi && runuser -u browsercheck -- env NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/opt/gpi-browsers /usr/local/bin/gpi-node --import tsx scripts/verify-browser-engine.ts');
    // Credentials are never build inputs, written to disk, or checkpointed.
    this.template=await recipe.build(this.options());
  }
  async create(generation:string) {
    if(!this.template)throw Error('runtime_not_prepared');
    const ref=(variable:string)=>'${{'+this.config.service+'.'+variable+'}}';
    const vm=await Sandbox.create(this.template,{...this.options(),idleTimeoutMinutes:10,
      networkIsolation:'PRIVATE',resources:{cpu:1,memoryGB:2},env:{
        NODE_ENV:'production',PLAYWRIGHT_BROWSERS_PATH:'/opt/gpi-browsers',BROWSER_RUNTIME_GENERATION:generation,
        DATABASE_URL:ref('DATABASE_URL'),RESEARCH_MODEL_API_KEY:ref(this.config.key),RESEARCH_MODEL_NAME:ref(this.config.model),
        BROWSER_SOURCE_ORIGINS:this.config.origins,
      }});
    return vm.id;
  }
  async start(vmId:string) {
    const vm=await Sandbox.connect(vmId,this.options());
    const handle=vm.exec('exec runuser -u browsercheck -- /usr/bin/dumb-init -- /usr/local/bin/gpi-node --import tsx scripts/browser-worker.ts',
      {cwd:'/opt/gpi',captureOutput:false});
    // Observe rejection, but never log raw provider output or error envelopes.
    void handle.catch(()=>{});
    return await handle.detach();
  }
  async running(vmId:string,session:string) {
    try{
      const vm=await Sandbox.connect(vmId,this.options());await vm.heartbeat();
      const sessions=await vm.sessions();
      if(!sessions)throw Error('runtime_sessions_unavailable');
      return sessions.some(s=>s.name===session&&s.kind==='EXEC'&&s.running);
    }catch(e){if(e instanceof SandboxNotFoundError)return false;throw Error('runtime_health_unavailable');}
  }
  async destroy(vmId:string) {
    try{await (await Sandbox.connect(vmId,this.options())).destroy();}
    catch(e){if(!(e instanceof SandboxNotFoundError))throw Error('runtime_destruction_unconfirmed');}
  }
}
