import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import * as schema from '../src/lib/db/schema';
const state=vi.hoisted(()=>({db:null as PGlite|null}));
vi.mock('../src/lib/db',()=>({db:new Proxy({}, {get(_target,key){const db=drizzle(state.db!,{schema});const value=Reflect.get(db,key);return typeof value==='function'?value.bind(db):value;}})}));
import {analysisAccessAllowed} from '../src/lib/integrations/analysis-access';
import {POST} from '../src/app/api/integration/v1/analysis-access/route';
import {signHandoff} from '../src/lib/integrations/workspace-handoff';
const user='550e8400-e29b-41d4-a716-446655440001',account='550e8400-e29b-41d4-a716-446655440002',session='550e8400-e29b-41d4-a716-446655440003';
const secret='isolated-security-test-signing-'.repeat(2),service='isolated-service-test-'.repeat(3);
function ticket(patch:Record<string,unknown>={}){const now=Math.floor(Date.now()/1000);return signHandoff({version:'workspace-handoff.v1',workspaceId:account,reviewerUserId:user,issuerId:'us:0000320193',candidateKey:'XNAS:AAPL',ticker:'AAPL',nonce:crypto.randomUUID(),issuedAt:now,expiresAt:now+7200,sessionId:session,audience:'filinglens',permissions:['analysis:run','valuation:publish'],...patch},secret);}
const request=(body:unknown,authorization='Bearer '+service)=>new Request('https://gpi.example/api/integration/v1/analysis-access',{method:'POST',headers:{'content-type':'application/json',authorization},body:JSON.stringify(body)});
beforeAll(async()=>{state.db=new PGlite();await state.db.exec(readFileSync('migrations/001_foundation.sql','utf8'));},30000);
beforeEach(async()=>{
 vi.stubEnv('INTEGRATION_SIGNING_SECRET',secret);vi.stubEnv('FILINGLENS_CORPUS_TOKEN',service);
 await state.db!.exec('TRUNCATE users CASCADE');
 await state.db!.query('INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',[user,'synthetic@example.test','Synthetic','not-a-login-hash']);
 await state.db!.query('INSERT INTO accounts(id,name,owner_user_id) VALUES($1,$2,$3)',[account,'Synthetic account',user]);
 await state.db!.query("INSERT INTO memberships(user_id,account_id,role,accepted_at) VALUES($1,$2,'analyst',now())",[user,account]);
 await state.db!.query("INSERT INTO user_sessions(id,user_id,token_hash,expires_at,last_seen_at) VALUES($1,$2,'synthetic-digest',now()+interval '1 day',now())",[session,user]);
});
afterAll(async()=>{await state.db?.close();vi.unstubAllEnvs();});
it('requires the service identity; a browser cookie or claimed workspace is insufficient',async()=>{
 expect((await POST(request({ticket:ticket()},''))).status).toBe(401);
 expect((await POST(request({ticket:ticket()},'Bearer wrong'))).status).toBe(401);
 expect((await POST(request({ticket:ticket(),workspaceId:account}))).status).toBe(400);
 const response=await POST(request({ticket:ticket()}));expect(response.status).toBe(200);
 expect(await response.json()).toEqual({allowed:true});expect(response.headers.get('cache-control')).toBe('no-store');
});
it.each([
 ['revoked session',"UPDATE user_sessions SET revoked_at=now()"],
 ['expired session',"UPDATE user_sessions SET expires_at=now()-interval '1 second'"],
 ['idle session',"UPDATE user_sessions SET last_seen_at=now()-interval '9 hours'"],
 ['disabled user',"UPDATE users SET disabled_at=now()"],
 ['viewer role',"UPDATE memberships SET role='viewer'"],
 ['unaccepted membership',"UPDATE memberships SET accepted_at=NULL"],
 ['removed membership',"DELETE FROM memberships"],
])('denies %s without caching an earlier allow',async(_label,sql)=>{
 const value=ticket();expect(await analysisAccessAllowed(value)).toBe(true);
 await state.db!.exec(sql);expect(await analysisAccessAllowed(value)).toBe(false);
 expect((await POST(request({ticket:value}))).status).toBe(403);
});
it('does not authorize fallback account, another session/reviewer or legacy unbound ticket',async()=>{
 for(const patch of [{workspaceId:crypto.randomUUID()},{sessionId:crypto.randomUUID()},{reviewerUserId:crypto.randomUUID()},{sessionId:undefined},{audience:undefined},{permissions:[]}])
  expect(await analysisAccessAllowed(ticket(patch))).toBe(false);
 expect(await analysisAccessAllowed(ticket({permissions:['analysis:run']}),'valuation:publish')).toBe(false);
});
it('rejects tampering and expiry; oversized requests are bounded',async()=>{
 const now=Math.floor(Date.now()/1000);
 for(const value of [ticket()+'x',ticket({issuedAt:now-8000,expiresAt:now-1000})])
  expect((await POST(request({ticket:value}))).status).toBe(403);
 expect((await POST(request({ticket:'x'.repeat(3000)}))).status).toBe(413);
});
