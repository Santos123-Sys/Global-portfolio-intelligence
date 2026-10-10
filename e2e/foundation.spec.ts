import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import seed from '../data/usa-cvm-universe.json' with { type: 'json' };
import { defaultProfile } from '../src/lib/foundation/contracts';
import fixture from '../tests/fixtures/filinglens-public-finance-v1.json' with { type: 'json' };

test('signed-out visitors must authenticate; legacy APIs no longer exist',async({page,request})=>{
  const redirect=await request.get('/',{maxRedirects:0});expect(redirect.status()).toBe(307);expect(redirect.headers().location).toContain('/login');
  await page.goto('/login');await expect(page.getByRole('heading',{name:'Discovery starts with evidence.'})).toBeVisible();
  await page.route('**/api/auth/session',async route=>route.fulfill({status:401,json:{error:'Synthetic invalid credentials'}}));
  await page.getByLabel('Email').fill('synthetic@example.test');await page.getByLabel('Password',{exact:true}).fill('synthetic-only-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'Synthetic invalid credentials'})).toBeVisible();
  expect((await request.get('/api/analysis')).status()).toBe(404);
  expect((await request.get('/api/foundation')).status()).toBe(401);
});
for(const width of [390,1440])test(`candidate → screen → research foundation at ${width}px`,async({page,context})=>{
  await page.setViewportSize({width,height:1000});
  const payload=`550e8400-e29b-41d4-a716-446655440000.${Date.now()+3600000}.${'n'.repeat(43)}`;
  const sig=createHmac('sha256','browser-test-only-session-secret-at-least-32-characters').update(payload).digest('base64url');
  await context.addCookies([{name:'portfolio_session',value:`${payload}.${sig}`,url:'http://127.0.0.1:3100',httpOnly:true,sameSite:'Lax'}]);
  const candidate={...seed.candidates.find(c=>c.market==='us')!,issuer:fixture.snapshot.issuer};
  const workspace={version:1,profile:defaultProfile,candidates:[candidate]};
  const finance={status:'ready',snapshot:fixture.snapshot};
  const screen={candidate,status:'PASS',finance,screenedAt:'2026-10-09T00:00:00Z',policyVersion:'usa-cvm-foundation-v1',decisions:[]};
  const jobs:unknown[]=[];const writes:string[]=[];
  await page.route('**/api/foundation',async route=>{
    const req=route.request();if(req.method()==='POST'){
      const body=req.postDataJSON();writes.push(body.kind);
      const output=body.kind==='screen'?{kind:'screen',screens:[screen]}:{kind:'research',modelStatus:'disabled_or_no_evidence',report:{candidate,screen,draft:null,questions:{bull:['Which facts support growth?'],bear:['Which facts challenge growth?'],review:[]},valuation:{reason:'Valuation must be performed in FilingLens.'},limitations:['Human review required.']}};
      jobs.unshift({id:body.idempotencyKey,kind:body.kind,status:'complete',created_at:'2026-10-09T00:00:00Z',error_code:null,output});
      await route.fulfill({status:202,json:{id:body.idempotencyKey,status:'queued'}});
    }else if(req.method()==='PUT'){writes.push('profile');await route.fulfill({json:{workspace:req.postDataJSON()}});}
    else await route.fulfill({json:{workspace,jobs,integrations:{finance:'configured_read_attempts',researchModel:'disabled'}}});
  });
  await page.goto('/');await expect(page.getByRole('heading',{name:'Candidate watchlist'})).toBeVisible();
  await page.getByRole('button',{name:'Run screening'}).click();await expect(page.getByRole('heading',{name:'Durable job activity'})).toBeVisible();
  await page.getByRole('tab',{name:'Candidates',exact:true}).click();await expect(page.getByText('PASS',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Evidence pack',exact:true}).click();await page.getByRole('tab',{name:'Research',exact:true}).click();
  await expect(page.getByRole('heading',{name:'FilingLens evidence'})).toBeVisible();await expect(page.getByText('120 USD',{exact:true})).toBeVisible();
  await expect(page.getByText('Valuation must be performed in FilingLens.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:`/tmp/gpi-foundation-${width}.png`,fullPage:true});
  await page.getByRole('tab',{name:'Investor profile',exact:true}).click();await page.getByLabel('Profile name').fill('New profile');
  await page.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.getByRole('status')).toContainText('Investor profile saved');
  expect(writes).toEqual(['screen','research','profile']);
});
