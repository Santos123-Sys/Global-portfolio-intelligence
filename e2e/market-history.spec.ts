import {test,expect} from '@playwright/test';
import {createHmac} from 'node:crypto';
import seed from '../data/usa-cvm-universe.json' with {type:'json'};
import {defaultProfile} from '../src/lib/foundation/contracts';
for(const width of [390,1440])test(`saved disabled evidence has recovery and dataset lineage at ${width}px`,async({page,context})=>{
 await page.setViewportSize({width,height:1000});
 const payload=`550e8400-e29b-41d4-a716-446655440000.${Date.now()+3600000}.${'n'.repeat(43)}`;
 const sig=createHmac('sha256','browser-test-only-session-secret-at-least-32-characters').update(payload).digest('base64url');
 await context.addCookies([{name:'portfolio_session',value:`${payload}.${sig}`,url:'http://127.0.0.1:3100',httpOnly:true,sameSite:'Lax'}]);
 const candidate=seed.candidates.find(c=>c.ticker==='AAPL')!;let queued=0;
 await page.route('**/api/foundation',route=>{
  if(route.request().method()==='POST'){queued++;expect(route.request().postDataJSON().candidateKey).toBe(candidate.key);return route.fulfill({status:202,json:{status:'queued'}});}
  return route.fulfill({json:{workspace:{version:1,profile:defaultProfile,candidates:[candidate]},integrations:{finance:'configured_read_attempts',researchModel:'enabled'},jobs:[{
   id:'550e8400-e29b-41d4-a716-446655440001',kind:'research',status:'complete',created_at:'2026-10-19T12:00:00Z',output:{kind:'research',modelStatus:'disabled_or_no_evidence',
    report:{candidate,screen:{finance:{status:'disabled',reason:'FilingLens public finance reads are not enabled.'}},questions:{bull:[],bear:[]},draft:null,deepResearch:null,valuation:{reason:'Valuation remains in FilingLens.'},limitations:[]}}}]}});
 });
 await page.route('**/api/integration/v1/market-history',route=>route.fulfill({json:{enabled:true,jobs:[{candidate_key:candidate.key,symbol:'AAPL',status:'complete',error_code:null}],snapshots:[{
  id:'mh1_'+'a'.repeat(64),source_hash:'a'.repeat(64),candidate_key:candidate.key,symbol:'AAPL',retrieved_at:'2026-10-19T12:00:00Z',stale:false,
  quality:{status:'ready',observations:1258,firstDate:'2021-10-19',lastDate:'2026-10-16',missingSessions:[],issues:[],metrics:{annualizedVolatility:.2,maxDrawdown:-.3,historicalVar95:.02},methodology:'Synthetic adjustment-aware fixture.',limitations:['Single unofficial provider; no independent price reconciliation.']}}]}}));
 await page.goto('/');await page.getByRole('tab',{name:'Research',exact:true}).click();
 await expect(page.getByText('Evidence pack saved; no AI draft was produced.',{exact:true})).toBeVisible();
 await expect(page.getByText(/Current connection: enabled/)).toBeVisible();
 await expect(page.getByText('Quality checks passed',{exact:true})).toBeVisible();
 await page.getByText('Inspect provenance, checks and limitations',{exact:true}).click();
 await expect(page.getByRole('link',{name:'Inspect daily prices, returns and source lineage (JSON)'})).toHaveAttribute('href',/snapshotId=mh1_/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.getByRole('button',{name:'Retry evidence pack',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('heading',{name:'Durable job activity'})).toBeVisible();expect(queued).toBe(1);
});
