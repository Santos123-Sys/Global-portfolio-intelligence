import {acquireSecondaryEvidence} from './secondary-evidence';
import {randomUUID} from 'node:crypto';
import {sql,loadWorkspace} from '../foundation/store';
import {assessHistory,historyHash,historyIdentity} from './history-quality';
export {historyIdentity} from './history-quality';
import type {MarketHistory} from './history-quality';
import {readBoundedJson} from '../request-body';

export async function queueHistory(owner:string,key:string,refresh=false) {
  if(process.env.MARKET_HISTORY_ENABLED!=='true')throw Error('history_disabled');
  const candidate=(await loadWorkspace(owner)).candidates.find(c=>c.key===key);
  if(!candidate)throw Error('candidate_not_found');
  const identity=historyIdentity(candidate);
  await sql()`INSERT INTO gpi_market_history_jobs(id,owner_id,candidate_key,issuer_id,symbol,as_of)
    VALUES(${randomUUID()},${owner},${key},${identity.issuerId},${identity.symbol},CURRENT_DATE)
    ON CONFLICT(owner_id,candidate_key,issuer_id,as_of) DO UPDATE SET
      status=CASE WHEN (gpi_market_history_jobs.status='failed' OR (${refresh} AND gpi_market_history_jobs.status='complete')) AND gpi_market_history_jobs.attempts<3 THEN 'queued' ELSE gpi_market_history_jobs.status END`;
}
export function riskConnection() {
  const base=new URL(process.env.PORTFOLIO_RISK_API_URL??''),token=process.env.PORTFOLIO_RISK_API_TOKEN??'';
  if(base.protocol!=='https:'||base.pathname!=='/'||base.username||base.password||base.search||base.hash||token.length<32||/[\r\n]/.test(token))throw Error('risk_provider_not_configured');
  return {base,token};
}
export async function processHistory(fetcher:typeof fetch=fetch) {
  if(process.env.MARKET_HISTORY_ENABLED!=='true')return;
  await sql()`UPDATE gpi_market_history_jobs SET status=CASE WHEN attempts<3 THEN 'queued' ELSE 'failed' END,
    error_code='history_lease_expired' WHERE status='running' AND lease_until<now()`;
  const lease=randomUUID();
  const rows=await sql()`UPDATE gpi_market_history_jobs SET status='running',attempts=attempts+1,
    lease_token=${lease},lease_until=now()+interval '90 seconds'
    WHERE id=(SELECT id FROM gpi_market_history_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
  const job=rows[0];if(!job)return;
  try {
    const {base,token}=riskConnection();
    const response=await fetcher(new URL('/v1/market-history',base),{method:'POST',redirect:'error',cache:'no-store',
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:JSON.stringify({symbol:job.symbol,issuerId:job.issuer_id}),signal:AbortSignal.timeout(45000)});
    if(!response.ok){await response.body?.cancel();throw Error(response.status===401?'history_provider_unauthorized':'history_provider_unavailable');}
    const body=await readBoundedJson(new Request('https://response.invalid',{method:'POST',body:response.body,
      headers:{'content-type':response.headers.get('content-type')??''},duplex:'half'} as RequestInit),700000);
    if(!body.ok)throw Error('history_contract_invalid');
    assessHistory(body.value,{symbol:job.symbol,issuerId:job.issuer_id});
    const history=body.value as MarketHistory;
    Object.assign(history,await acquireSecondaryEvidence(history,fetcher));
    const quality=assessHistory(history,{symbol:job.symbol,issuerId:job.issuer_id});
    const hash=await historyHash(body.value),id='mh1_'+hash;
    await sql().begin(async tx=>{
      const held=await tx`SELECT id FROM gpi_market_history_jobs WHERE id=${job.id} AND status='running' AND lease_token=${lease} AND lease_until>now() FOR UPDATE`;
      if(!held.length)return;
      await tx`INSERT INTO gpi_market_history_snapshots(id,owner_id,candidate_key,issuer_id,symbol,source_hash,payload,quality)
        VALUES(${id},${job.owner_id},${job.candidate_key},${job.issuer_id},${job.symbol},${hash},${tx.json(body.value as never)},${tx.json(quality)})
        ON CONFLICT(owner_id,id) DO NOTHING`;
      await tx`UPDATE gpi_market_history_jobs SET status='complete',snapshot_id=${id},error_code=null,lease_until=null WHERE id=${job.id} AND lease_token=${lease}`;
    });
    console.log(JSON.stringify({kind:'market_history',status:quality.status,symbol:job.symbol,observations:quality.observations}));
  }catch(e){
    const reason=e instanceof Error&&/^history_[a-z_]+$/.test(e.message)?e.message:'history_validation_failed';
    await sql()`UPDATE gpi_market_history_jobs SET status='failed',error_code=${reason},lease_until=null WHERE id=${job.id} AND lease_token=${lease}`;
    console.error(JSON.stringify({kind:'market_history',status:'failed',reason}));
  }
}
export async function listHistory(owner:string) {
  const jobs=await sql()`SELECT candidate_key,symbol,status,error_code,snapshot_id,as_of,attempts FROM gpi_market_history_jobs WHERE owner_id=${owner} ORDER BY as_of DESC,created_at DESC LIMIT 100`;
  const snapshots=await sql()<{id:string;candidate_key:string;symbol:string;source_hash:string;quality:Omit<ReturnType<typeof assessHistory>,'returns'>;retrieved_at:string;created_at:string}[]>`SELECT id,candidate_key,symbol,source_hash,quality - 'returns' AS quality,payload->>'retrievedAt' AS retrieved_at,created_at FROM gpi_market_history_snapshots WHERE owner_id=${owner} ORDER BY created_at DESC LIMIT 100`;
  return {jobs,snapshots:snapshots.map(s=>({...s,stale:Date.now()-Date.parse(s.retrieved_at)>8*86400000}))};
}
export async function readHistory(owner:string,id:string){
  if(!/^mh1_[a-f0-9]{64}$/.test(id))throw Error('history_not_found');
  const rows=await sql()`SELECT id,source_hash,payload FROM gpi_market_history_snapshots WHERE owner_id=${owner} AND id=${id}`;
  const row=rows[0];if(!row)throw Error('history_not_found');
  if(await historyHash(row.payload)!==row.source_hash||id!=='mh1_'+row.source_hash)throw Error('history_integrity_failed');
  const history=row.payload as MarketHistory;
  return {snapshotId:id,sourceHash:row.source_hash,history,
    quality:assessHistory(history,history,Date.parse(history.retrievedAt)),
    stale:Date.now()-Date.parse(history.retrievedAt)>8*86400000};
}
export async function storedHistory(owner:string,identity:ReturnType<typeof historyIdentity>) {
  const rows=await sql()`SELECT id,source_hash,payload FROM gpi_market_history_snapshots WHERE owner_id=${owner}
    AND candidate_key=${identity.candidateKey} AND issuer_id=${identity.issuerId} AND symbol=${identity.symbol} ORDER BY created_at DESC LIMIT 1`;
  const row=rows[0];if(!row)throw Error('history_not_prepared');
  if(await historyHash(row.payload)!==row.source_hash||row.id!=='mh1_'+row.source_hash)throw Error('history_integrity_failed');
  const quality=assessHistory(row.payload,identity);
  if(quality.status!=='ready')throw Error('history_quality_blocked');
  if(process.env.PRICE_RECONCILIATION_REQUIRED==='true'&&quality.reconciliation.status!=='matched')throw Error('history_reconciliation_required');
  return {snapshotId:row.id as string,sourceHash:row.source_hash as string,history:row.payload as MarketHistory};
}
