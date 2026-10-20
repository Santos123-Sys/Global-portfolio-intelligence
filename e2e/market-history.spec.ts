import {test,expect} from '@playwright/test';
import {createHmac} from 'node:crypto';
import seed from '../data/usa-cvm-universe.json' with {type:'json'};
import {defaultProfile} from '../src/lib/foundation/contracts';
import {assessHistory} from '../src/lib/market/history-quality';
import {historyFixture} from '../tests/market-history-fixture';
for(const width of [390,1440])for(const verification of ['unverified','partial','disputed'] as const)test(`saved evidence and ${verification} prices have recovery and lineage at ${width}px`,async({page,context})=>{
 await page.setViewportSize({width,height:1000});
 const payload=`550e8400-e29b-41d4-a716-446655440000.${Date.now()+3600000}.${'n'.repeat(43)}`;
 const sig=createHmac('sha256','browser-test-only-session-secret-at-least-32-characters').update(payload).digest('base64url');
 await context.addCookies([{name:'portfolio_session',value:`${payload}.${sig}`,url:'http://127.0.0.1:3100',httpOnly:true,sameSite:'Lax'}]);
 const candidate=seed.candidates.find(c=>c.ticker==='AAPL')!;let queued=0,refreshed=0;
 const h=historyFixture();
 if(verification!=='unverified')h.secondary={provider:'EODHD',sourceUrl:'https://eodhd.com/api/eod/AAPL.US',symbol:h.symbol,issuerId:h.issuerId,currency:'USD',timezone:'America/New_York',retrievedAt:h.retrievedAt,rawSha256:'a'.repeat(64),priceBasis:'split-dividend-adjusted',rows:h.rows.slice(-251).map((r,i)=>({date:r.date,adjustedClose:r.adjustedClose*(verification==='disputed'&&i===5?1.02:1)}))};
 const quality=assessHistory(h,h,Date.parse('2026-10-19T13:00:00Z'));
 await page.route('**/api/foundation',route=>{
  if(route.request().method()==='POST'){queued++;expect(route.request().postDataJSON().candidateKey).toBe(candidate.key);return route.fulfill({status:202,json:{status:'queued'}});}
  return route.fulfill({json:{workspace:{version:1,profile:defaultProfile,candidates:[candidate]},integrations:{finance:'configured_read_attempts',researchModel:'enabled'},jobs:[{
   id:'550e8400-e29b-41d4-a716-446655440001',kind:'research',status:'complete',created_at:'2026-10-19T12:00:00Z',output:{kind:'research',modelStatus:'disabled_or_no_evidence',
    report:{candidate,screen:{finance:{status:'disabled',reason:'FilingLens public finance reads are not enabled.'}},questions:{bull:[],bear:[]},draft:null,deepResearch:null,valuation:{reason:'Valuation remains in FilingLens.'},limitations:[]}}}]}});
 });
 await page.route('**/api/integration/v1/market-history',route=>{
  if(route.request().method()==='POST'){expect(route.request().postDataJSON()).toEqual({candidateKey:candidate.key,refresh:true});refreshed++;return route.fulfill({status:202,json:{status:'queued_or_already_prepared'}});}
  return route.fulfill({json:{enabled:true,jobs:[{candidate_key:candidate.key,symbol:'AAPL',status:'complete',error_code:null}],snapshots:[{
  id:'mh1_'+'a'.repeat(64),source_hash:'a'.repeat(64),candidate_key:candidate.key,symbol:'AAPL',retrieved_at:'2026-10-19T12:00:00Z',stale:false,
  quality}]}});});
 await page.goto('/');await page.getByRole('tab',{name:'Research',exact:true}).click();
 await expect(page.getByText('Evidence pack saved; no AI draft was produced.',{exact:true})).toBeVisible();
 await expect(page.getByText(/Current connection: enabled/)).toBeVisible();
 await expect(page.getByText(verification==='disputed'?'Quarantined: review required':'Structural checks passed',{exact:true})).toBeVisible();
 await expect(page.getByText(verification==='unverified'?'not_configured':verification,{exact:true})).toBeVisible();
 if(verification==='partial')await expect(page.getByText(/The rest of the five-year history remains unverified/)).toBeVisible();
 if(verification==='disputed')await expect(page.getByText(/Conflicting prices block portfolio use/)).toBeVisible();
 await page.getByText('Inspect provenance, checks and limitations',{exact:true}).click();
 await expect(page.getByRole('link',{name:'Inspect daily prices, returns and source lineage (JSON)'})).toHaveAttribute('href',/snapshotId=mh1_/);
 if(verification!=='unverified')await expect(page.getByRole('table',{name:'Adjusted-price risk comparison'})).toBeVisible();
 if(verification==='disputed')await expect(page.getByRole('heading',{name:'First conflicting returns'})).toBeVisible();
 await page.getByRole('button',{name:'Prepare or refresh AAPL history'}).click();await expect(page.getByRole('status').filter({hasText:'Request saved.'})).toBeVisible();expect(refreshed).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.getByRole('button',{name:'Retry evidence pack',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('heading',{name:'Durable job activity'})).toBeVisible();expect(queued).toBe(1);
});
