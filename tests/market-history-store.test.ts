import {PGlite,type Transaction} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {vi,it,expect,beforeAll,afterAll} from 'vitest';
import {fiveYearStart} from '../src/lib/market/history-quality';
const state=vi.hoisted(()=>({db:null as PGlite|null}));
vi.mock('postgres',()=>{
 function tag(db:PGlite|Transaction){
  const fn=async(s:TemplateStringsArray,...p:unknown[])=>{const q=s.reduce((a,v,i)=>a+(i?'$'+i:'')+v,'');return (await db.query(q,p)).rows;};
  fn.json=(v:unknown)=>JSON.stringify(v);fn.begin=(work:(tx:ReturnType<typeof tag>)=>Promise<unknown>)=>state.db!.transaction(tx=>work(tag(tx)));return fn;
 }return {default:()=>tag(state.db!)};
});
import {queueHistory,processHistory,listHistory,storedHistory,readHistory} from '../src/lib/market/history-store';
import {enqueue,claimJob,finishJob} from '../src/lib/foundation/store';
import {defaultProfile} from '../src/lib/foundation/contracts';
const owner='550e8400-e29b-41d4-a716-446655440000',other='550e8400-e29b-41d4-a716-446655440001';
const identity={candidateKey:'XNAS:AAPL',symbol:'AAPL',issuerId:'us:0000320193'};
const candidate={key:'XNAS:AAPL',ticker:'AAPL',name:'Apple',exchange:'XNAS',market:'us',issuer:{jurisdiction:'us',registryId:'0000320193'},identitySourceUrl:'https://www.sec.gov/edgar/browse/?CIK=320193'};
function payload(){
 const end=new Date().toISOString().slice(0,10),start=fiveYearStart(end),dates:string[]=[];
 for(let n=Date.parse(start);n<Date.parse(end);n+=86400000){const d=new Date(n);if(![0,6].includes(d.getUTCDay()))dates.push(d.toISOString().slice(0,10));}
 return {schemaVersion:'market-history.v1',symbol:'AAPL',issuerId:identity.issuerId,currency:'USD',exchange:'NMS',timezone:'America/New_York',provider:'Yahoo Finance (unofficial)',sourceUrl:'https://query1.finance.yahoo.com/v8/finance/chart/AAPL',retrievedAt:new Date().toISOString(),requestedStart:start,requestedEnd:end,priceBasis:'vendor-adjusted-close',corporateActions:[],reference:{symbol:'SPY',dates},rows:dates.map((date,i)=>({date,adjustedClose:100+i*.01,close:120+i*.01,volume:1000}))};
}
beforeAll(async()=>{
 vi.stubEnv('DATABASE_URL','postgres://isolated/test');vi.stubEnv('MARKET_HISTORY_ENABLED','true');vi.stubEnv('PORTFOLIO_RISK_API_URL','https://risk.example/');vi.stubEnv('PORTFOLIO_RISK_API_TOKEN','t'.repeat(40));
 state.db=new PGlite();for(const name of ['001_foundation.sql','002_gpi_integration.sql','003_document_corpus.sql','008_market_history.sql','008_market_history.sql'])await state.db.exec(readFileSync('migrations/'+name,'utf8'));
 await state.db.query("INSERT INTO users(id,email,display_name,password_hash) VALUES($1,'owner@test.invalid','Owner','test'),($2,'other@test.invalid','Other','test')",[owner,other]);
},30000);
afterAll(async()=>{await state.db?.close();vi.unstubAllEnvs();});
it('atomically queues history after successful research and fences duplicate completion',async()=>{
 await enqueue(owner,{kind:'research',candidateKey:'XNAS:AAPL',workspace:{version:1,profile:defaultProfile,candidates:[candidate]},idempotencyKey:crypto.randomUUID()});
 const job=(await claimJob())!;expect(await finishJob(job,{report:{},trace:{}})).toBe(true);expect(await finishJob(job,{})).toBe(false);
 const data=await listHistory(owner);expect(data.jobs).toHaveLength(1);expect(data.jobs[0].status).toBe('queued');
});
it('persists once, validates hash on read, and isolates owners',async()=>{
 await queueHistory(owner,'XNAS:AAPL');expect((await listHistory(owner)).jobs).toHaveLength(1);
 const transport=vi.fn(async()=>Response.json(payload()));await processHistory(transport as typeof fetch);await processHistory(transport as typeof fetch);
 expect(transport).toHaveBeenCalledTimes(1);const data=await listHistory(owner);expect(data.snapshots).toHaveLength(1);expect(data.snapshots[0].quality.status).toBe('ready');
 const result=await storedHistory(owner,identity);expect(result.snapshotId).toMatch(/^mh1_/);
 expect((await readHistory(owner,result.snapshotId)).quality.returns.length).toBeGreaterThan(1100);
 expect((await listHistory(other)).snapshots).toHaveLength(0);await expect(readHistory(other,result.snapshotId)).rejects.toThrow('history_not_found');
 await state.db!.query("UPDATE gpi_market_history_snapshots SET payload=jsonb_set(payload,'{rows,0,close}','1') WHERE owner_id=$1",[owner]);
 await expect(storedHistory(owner,identity)).rejects.toThrow('history_integrity_failed');
});
it('bounds provider failure retries and does not publish failed responses',async()=>{
 await state.db!.query("UPDATE gpi_market_history_jobs SET status='failed',attempts=0,snapshot_id=null WHERE owner_id=$1",[owner]);
 const transport=vi.fn(async()=>Response.json({error:'unavailable'},{status:503}));
 for(let i=0;i<4;i++){await queueHistory(owner,'XNAS:AAPL');await processHistory(transport as typeof fetch);}
 expect(transport).toHaveBeenCalledTimes(3);expect((await listHistory(owner)).jobs[0].status).toBe('failed');
});
it('refreshes completed jobs once, preserves snapshots, persists partial coverage and enforces the strict gate and daily cap',async()=>{
 await state.db!.query("UPDATE gpi_market_history_jobs SET status='complete',attempts=0 WHERE owner_id=$1",[owner]);
 const oldSnapshots=(await state.db!.query<{id:string;payload:unknown}>('SELECT id,payload FROM gpi_market_history_snapshots WHERE owner_id=$1 ORDER BY id',[owner])).rows;
 vi.stubEnv('EODHD_API_KEY','synthetic');vi.stubEnv('PRICE_RECONCILIATION_ENABLED','true');
 const transport=vi.fn(async(url:RequestInfo|URL)=>{
  const h=payload();return Response.json(String(url).startsWith('https://eodhd.com/')?h.rows.slice(-251).map(r=>({date:r.date,adjusted_close:r.adjustedClose})):h);
 });
 try{
  await queueHistory(owner,'XNAS:AAPL');await processHistory(transport as typeof fetch);expect(transport).not.toHaveBeenCalled();
  await queueHistory(owner,'XNAS:AAPL',true);await queueHistory(owner,'XNAS:AAPL',true);
  await processHistory(transport as typeof fetch);await processHistory(transport as typeof fetch);expect(transport).toHaveBeenCalledTimes(2);
  const prepared=await storedHistory(owner,identity),q=(await readHistory(owner,prepared.snapshotId)).quality;
  expect(q.status).toBe('ready');expect(q.reconciliation.status).toBe('partial');expect(q.reconciliation.comparedSessions).toBe(251);
  expect(q.limitations.join(' ')).toContain('full five-year history is not independently verified');
  vi.stubEnv('PRICE_RECONCILIATION_REQUIRED','true');await expect(storedHistory(owner,identity)).rejects.toThrow('history_reconciliation_required');
  vi.stubEnv('PRICE_RECONCILIATION_REQUIRED','false');
  for(let i=0;i<3;i++){await queueHistory(owner,'XNAS:AAPL',true);await processHistory(transport as typeof fetch);}
  expect(transport).toHaveBeenCalledTimes(6);expect((await listHistory(owner)).jobs[0].attempts).toBe(3);
  for(const old of oldSnapshots){const actual=await state.db!.query<{payload:unknown}>('SELECT payload FROM gpi_market_history_snapshots WHERE owner_id=$1 AND id=$2',[owner,old.id]);expect(actual.rows[0].payload).toEqual(old.payload);}
 }finally{vi.stubEnv('PRICE_RECONCILIATION_ENABLED','false');vi.stubEnv('EODHD_API_KEY','');vi.stubEnv('PRICE_RECONCILIATION_REQUIRED','false');}
});
it('keeps the daily refresh key on UTC even when the database session uses a different day',async()=>{
 const timezone=new Date().getUTCHours()>=10?'Pacific/Kiritimati':'Etc/GMT+12';
 try{
  await state.db!.exec(`SET TIME ZONE '${timezone}'`);
  await queueHistory(owner,'XNAS:AAPL',true);
  expect((await listHistory(owner)).jobs).toHaveLength(1);
  const result=await state.db!.query<{valid:boolean}>("SELECT bool_and(as_of=(now() AT TIME ZONE 'UTC')::date) AS valid FROM gpi_market_history_jobs WHERE owner_id=$1",[owner]);
  expect(result.rows[0].valid).toBe(true);
 }finally{await state.db!.exec("SET TIME ZONE 'UTC'");}
});
