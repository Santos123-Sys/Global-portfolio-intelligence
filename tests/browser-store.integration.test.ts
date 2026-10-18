import {PGlite,type Transaction} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {vi,it,expect,beforeAll,beforeEach,afterAll} from 'vitest';
import {drizzle} from 'drizzle-orm/pglite';
import * as schema from '../src/lib/db/schema';
const state=vi.hoisted(()=>({db:null as PGlite|null}));
vi.mock('../src/lib/db',()=>({db:new Proxy({}, {get(_t,key){const db=drizzle(state.db!,{schema});const value=Reflect.get(db,key);return typeof value==='function'?value.bind(db):value;}})}));
vi.mock('postgres',()=>{
 function tag(db:PGlite|Transaction){
  const fn=async(strings:TemplateStringsArray,...params:unknown[])=>{const q=strings.reduce((s,x,i)=>s+(i?'$'+i:'')+x,'');return (await db.query(q,params)).rows;};
  fn.json=(v:unknown)=>JSON.stringify(v);fn.begin=(work:(tx:ReturnType<typeof tag>)=>Promise<unknown>)=>state.db!.transaction(tx=>work(tag(tx)));return fn;
 }return {default:()=>tag(state.db!)};
});
import {POST as login,DELETE as logout} from '../src/app/api/auth/session/route';
import {GET,POST} from '../src/app/api/browser-sessions/route';
import {GET as streamGet} from '../src/app/api/browser-sessions/stream/route';
import {hashPassword} from '../src/lib/password';
import {getOptionalSession,type AuthContext} from '../src/lib/auth';
import {createRun,readRun,submit,claimRun,reapRuns,locked,event,activeAuthority,advertiseBrowserWorker} from '../src/lib/browser/store';
import {saveWorkspace} from '../src/lib/foundation/store';
import {defaultProfile} from '../src/lib/foundation/contracts';
import {executeBrowserRun} from '../src/lib/browser/worker';
import {ResearchBrowser,FIXTURE_ORIGIN,FIXTURE_QUOTE} from '../src/lib/browser/engine';
let cookie='',otherCookie='',auth:AuthContext;
const owner='550e8400-e29b-41d4-a716-446655440000';
const req=(path:string,body?:unknown,c=cookie)=>new Request('https://gpi.example'+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{origin:'https://gpi.example','content-type':'application/json',cookie:c}});
const input=()=>({company:'XNAS:TEST',year:2025,question:'Find the annual customer retention evidence',sourceUrl:FIXTURE_ORIGIN+'/',idempotencyKey:crypto.randomUUID(),mode:'fixture' as const});
beforeAll(async()=>{
 vi.stubEnv('DATABASE_URL','postgres://isolated/test');vi.stubEnv('SESSION_SECRET','isolated-session-secret-'.repeat(3));vi.stubEnv('NODE_ENV','test');vi.stubEnv('PUBLIC_APP_URL','https://gpi.example');vi.stubEnv('BROWSER_WORKSPACE_ENABLED','true');vi.stubEnv('BROWSER_SOURCE_ORIGINS','https://reports.example.com');
 state.db=new PGlite();
 for(const name of ['001_foundation.sql','002_gpi_integration.sql','003_document_corpus.sql','004_portfolio_feedback.sql','005_browser_workspace.sql','006_browser_capacity.sql'])await state.db.exec(readFileSync('migrations/'+name,'utf8'));
 await state.db.exec(readFileSync('migrations/006_browser_capacity.sql','utf8'));
 const password=await hashPassword('Synthetic!Browser!Test!2026');
 await state.db.query("INSERT INTO users(id,email,display_name,password_hash) VALUES($1,'one@example.test','One',$3),($2,'two@example.test','Two',$3)",[owner,'550e8400-e29b-41d4-a716-446655440001',password]);
 cookie=(await login(req('/api/auth/session',{email:'one@example.test',password:'Synthetic!Browser!Test!2026'},''))).headers.get('set-cookie')!.split(';')[0];
 otherCookie=(await login(req('/api/auth/session',{email:'two@example.test',password:'Synthetic!Browser!Test!2026'},''))).headers.get('set-cookie')!.split(';')[0];
 auth=(await getOptionalSession(req('/')))!;
 await saveWorkspace(owner,{version:1,profile:defaultProfile,candidates:[{key:'XNAS:TEST',ticker:'TEST',name:'Example Industries',exchange:'XNAS',market:'us',identitySourceUrl:'https://www.sec.gov/',issuer:{jurisdiction:'us',registryId:'0000000001'}}]});
},30000);
beforeEach(async()=>{await state.db!.query('DELETE FROM gpi_browser_workers');await advertiseBrowserWorker('550e8400-e29b-41d4-a716-446655440099',true);});
afterAll(async()=>{await state.db?.close();vi.unstubAllEnvs();});
it('actual login and owner authorization protect snapshots, commands, streams and observations',async()=>{
 const r=await createRun(auth,input(),'us:0000000001','Example Industries');
 expect((await GET(req('/api/browser-sessions?id='+r.id,undefined,''))).status).toBe(401);
 expect((await GET(req('/api/browser-sessions?id='+r.id,undefined,otherCookie))).status).toBe(404);
 expect((await streamGet(req('/api/browser-sessions/stream?id='+r.id,undefined,otherCookie))).status).toBe(404);
 expect((await POST(req('/api/browser-sessions?id='+r.id,{id:crypto.randomUUID(),kind:'takeover',epoch:0},otherCookie))).status).toBe(404);
 await expect(submit({...auth,role:'viewer'},r.id,{id:crypto.randomUUID(),kind:'takeover',epoch:0})).rejects.toThrow('forbidden');
 await locked(r.id,async run=>{run.state='cancelled';});
});
it('idempotency, epoch fencing and orphan reconciliation preserve one effect',async()=>{
 const i=input(),run=await createRun(auth,i,'us:0000000001','Example Industries');
 expect((await createRun(auth,i,'us:0000000001','Example Industries')).id).toBe(run.id);
 await expect(createRun(auth,{...i,year:2024},'us:0000000001','Example Industries')).rejects.toThrow('idempotency_conflict');
 await claimRun(crypto.randomUUID());
 const command={id:crypto.randomUUID(),kind:'pause',epoch:0};
 const paused=await submit(auth,run.id,command);expect(paused.epoch).toBe(1);expect(paused.state).toBe('pausing');
 expect((await submit(auth,run.id,command)).epoch).toBe(1);
 await expect(submit(auth,run.id,{id:crypto.randomUUID(),kind:'resume',epoch:0})).rejects.toThrow('stale_control');
 await locked(run.id,async(r,tx)=>{r.leaseUntil=0;await event(tx,r,'action_dispatched','Synthetic unknown outcome');});
 await reapRuns();expect((await readRun(owner,run.id))?.state).toBe('reconciling');expect(await claimRun(crypto.randomUUID())).toBeNull();
});
it.skipIf(process.env.BROWSER_INTEGRATION!=='true')('real Chromium worker retains exact evidence with ordered durable receipts and replay observations',async()=>{
 const created=await createRun(auth,input(),'us:0000000001','Example Industries');
 const claimed=await claimRun(crypto.randomUUID());expect(claimed?.id).toBe(created.id);
 await executeBrowserRun(claimed!,new AbortController().signal);
 const run=(await readRun(owner,created.id))!;expect(run.state).toBe('completed');expect(run.evidence[0].text).toBe(FIXTURE_QUOTE);expect(run.actions).toBe(3);
 const response=await GET(req('/api/browser-sessions?id='+run.id));const body=await response.json();
 expect(body.events.filter((e:{type:string})=>e.type==='action_completed')).toHaveLength(3);
 expect(body.run.authSession).toBeUndefined();expect(body.run.owner).toBeUndefined();
 const replay=await GET(req(`/api/browser-sessions?id=${run.id}&observation=${run.evidence[0].observationId}`));expect((await replay.json()).observation.text).toContain(FIXTURE_QUOTE);
 const accept=await POST(req('/api/browser-sessions',{kind:'accept',id:run.id,evidenceId:run.evidence[0].id,issuerId:run.issuerId,year:2025,confirmed:true}));expect(accept.status).toBe(422);
},30000);
it.skipIf(process.env.BROWSER_INTEGRATION!=='true')('takeover fences a late model response, human input is once-only, and stop closes Chromium',async()=>{
 const created=await createRun(auth,{...input(),mode:'model'},'us:0000000001','Example Industries');
 const claimed=(await claimRun(crypto.randomUUID()))!;
 let release!:()=>void,entered!:()=>void;
 const waiting=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
 const task=executeBrowserRun(claimed,new AbortController().signal,{engine:new ResearchBrowser([FIXTURE_ORIGIN],true),model:async()=>{entered();await gate;return {value:{kind:'link',index:0},usage:{prompt_tokens:100,completion_tokens:10}};}});
 await waiting;
 const paused=await submit(auth,created.id,{id:crypto.randomUUID(),kind:'takeover',epoch:0});expect(paused.state).toBe('pausing');
 async function stateIs(wanted:string){for(let i=0;i<80;i++){const r=(await readRun(owner,created.id))!;if(r.state===wanted)return r;await new Promise(r=>setTimeout(r,50));}throw Error('state_timeout_'+wanted);}
 const human=await stateIs('human');expect(human.controller).toBe(auth.actorUserId);
 release();await new Promise(r=>setTimeout(r,100));expect((await readRun(owner,created.id))!.actions).toBe(0);
 const command={id:crypto.randomUUID(),kind:'input',epoch:human.epoch,observationId:human.observation!.id,action:{kind:'link',index:0}};
 await submit(auth,created.id,command);await submit(auth,created.id,command);
 for(let i=0;i<80;i++){if((await readRun(owner,created.id))!.actions===1)break;await new Promise(r=>setTimeout(r,50));}
 const after=(await readRun(owner,created.id))!;expect(after.actions).toBe(1);expect(after.observation!.text).toContain(FIXTURE_QUOTE);
 await expect(submit(auth,created.id,{...command,id:crypto.randomUUID()})).rejects.toThrow('stale_input');
 await submit(auth,created.id,{id:crypto.randomUUID(),kind:'stop',epoch:after.epoch});
 await task;expect((await readRun(owner,created.id))!.state).toBe('cancelled');
},30000);
it.skipIf(process.env.BROWSER_INTEGRATION!=='true')('real React canvas receives authenticated frames, keyboard takeover, replay and stop',async()=>{
 const created=await createRun(auth,{...input(),mode:'model'},'us:0000000001','Example Industries');
 const claimed=(await claimRun(crypto.randomUUID()))!;
 const stop=new AbortController();
 const task=executeBrowserRun(claimed,stop.signal,{engine:new ResearchBrowser([FIXTURE_ORIGIN],true),model:async(_s,_i,signal)=>{await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));throw Error('cancelled');}});
 const candidate={key:'XNAS:TEST',ticker:'TEST',name:'Example Industries',exchange:'XNAS',market:'us',issuer:{jurisdiction:'us',registryId:'0000000001'}};
 const bundle=await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {BrowserWorkspace} from './src/components/browser-workspace'; createRoot(document.getElementById('root')).render(<BrowserWorkspace candidate={${JSON.stringify(candidate)}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}});
 const server=createServer(async(req,res)=>{
  try{
   if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<html><body><main id="root"></main><script src="/app.js"></script></body></html>');return;}
   if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);
   const controller=new AbortController();res.on('close',()=>controller.abort());
   const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
   const request=new Request(`http://127.0.0.1:${(server.address() as {port:number}).port}${req.url}`,{method:req.method,headers,signal:controller.signal,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
   const response=req.url?.startsWith('/api/browser-sessions/stream')?await streamGet(request):req.method==='POST'?await POST(request):await GET(request);
   res.writeHead(response.status,Object.fromEntries(response.headers));
   if(response.body){const reader=response.body.getReader();try{while(!controller.signal.aborted){const {done,value}=await reader.read();if(done)break;if(!res.write(value))await once(res,'drain');}}finally{await reader.cancel().catch(()=>{});}}
   res.end();
  }catch{if(!res.headersSent)res.writeHead(500);res.end();}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 vi.stubEnv('PUBLIC_APP_URL',origin);
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext();const [name,...value]=cookie.split('=');await context.addCookies([{name,value:value.join('='),url:origin}]);
  const page=await context.newPage();await page.goto(origin);
  await page.getByRole('button',{name:'Take control',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('canvas')?.getContext('2d')?.getImageData(10,10,1,1).data[3]===255);
  await page.getByRole('button',{name:'Take control',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent?.includes('human'));
  await page.getByText('Observed page text and keyboard navigation',{exact:true}).click();
  await page.getByRole('button',{name:'2025 Annual report',exact:true}).focus();await page.keyboard.press('Enter');
  await page.waitForFunction((quote)=>document.querySelector('pre')?.textContent?.includes(quote),FIXTURE_QUOTE);
  await page.getByRole('button',{name:'Inspect observation',exact:true}).first().click();
  await page.getByText(/REPLAY — input disabled/).waitFor();expect(await page.getByRole('button',{name:'Scroll down',exact:true}).isEnabled()).toBe(false);
  await page.getByRole('button',{name:'Return to live view',exact:true}).click();
  await page.getByRole('button',{name:'Stop task',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent?.includes('cancelled'));
  expect((await readRun(owner,created.id))!.actions).toBe(1);
  for(const width of [390,1440]){await page.setViewportSize({width,height:1000});expect(await page.locator('canvas').isVisible()).toBe(true);}
 }finally{stop.abort();await task;await browser.close();server.closeAllConnections();server.close();vi.stubEnv('PUBLIC_APP_URL','https://gpi.example');}
},45000);
it('admission rejects absent, busy and expired capacity; an accepted retry remains idempotent',async()=>{
 await state.db!.query('DELETE FROM gpi_browser_workers');
 const i=input();
 await expect(createRun(auth,i,'us:0000000001','Example Industries')).rejects.toThrow('browser_capacity_unavailable');
 const worker=crypto.randomUUID();await advertiseBrowserWorker(worker,true);
 const accepted=await createRun(auth,i,'us:0000000001','Example Industries');
 await claimRun(worker);
 expect((await state.db!.query<{busy:boolean}>('SELECT busy FROM gpi_browser_workers WHERE id=$1',[worker])).rows[0].busy).toBe(true);
 // A retry retrieves the accepted run even when capacity is now occupied.
 expect((await createRun(auth,i,'us:0000000001','Example Industries')).id).toBe(accepted.id);
 await expect(createRun({...auth,userId:crypto.randomUUID()},input(),'us:0000000001','Example Industries')).rejects.toThrow('browser_capacity_unavailable');
 await advertiseBrowserWorker(worker,true);
 await state.db!.query("UPDATE gpi_browser_workers SET ready_until=now()-interval '1 second'");
 await expect(createRun({...auth,userId:crypto.randomUUID()},input(),'us:0000000001','Example Industries')).rejects.toThrow('browser_capacity_unavailable');
 await locked(accepted.id,async r=>{r.state='cancelled';});
});
it('logout revokes worker authority',async()=>{
 const run=await createRun(auth,input(),'us:0000000001','Example Industries');
 expect(await locked(run.id,(r,tx)=>activeAuthority(r,tx))).toBe(true);
 await logout(req('/api/auth/session'));
 expect(await locked(run.id,(r,tx)=>activeAuthority(r,tx))).toBe(false);
 expect((await GET(req('/api/browser-sessions?id='+run.id))).status).toBe(401);
});
