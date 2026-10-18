import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import seed from '../data/usa-cvm-universe.json' with { type: 'json' };
import { defaultProfile } from '../src/lib/foundation/contracts';
import fixture from '../tests/fixtures/filinglens-public-finance-v1.json' with { type: 'json' };
import appleAudit from '../tests/fixtures/apple-valuation-audit-v1.json' with { type: 'json' };

test('signed-out visitors must authenticate; legacy APIs no longer exist',async({page,request})=>{
  const redirect=await request.get('/',{maxRedirects:0});expect(redirect.status()).toBe(307);expect(redirect.headers().location).toContain('/login');
  await page.goto('/login');await expect(page.getByRole('heading',{name:'Discovery starts with evidence.'})).toBeVisible();
  await page.route('**/api/auth/session',async route=>route.fulfill({status:401,json:{error:'Synthetic invalid credentials'}}));
  await page.getByLabel('Email').fill('synthetic@example.test');await page.getByLabel('Password',{exact:true}).fill('synthetic-only-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'Synthetic invalid credentials'})).toBeVisible();
  expect((await request.get('/api/analysis')).status()).toBe(404);
  expect((await request.get('/api/foundation')).status()).toBe(401);
  expect((await request.get('/api/browser-verification')).status()).toBe(401);
});
for(const width of [390,1440])test(`candidate → screen → research foundation at ${width}px`,async({page,context})=>{
  await page.setViewportSize({width,height:1000});
  const payload=`550e8400-e29b-41d4-a716-446655440000.${Date.now()+3600000}.${'n'.repeat(43)}`;
  const sig=createHmac('sha256','browser-test-only-session-secret-at-least-32-characters').update(payload).digest('base64url');
  await context.addCookies([{name:'portfolio_session',value:`${payload}.${sig}`,url:'http://127.0.0.1:3100',httpOnly:true,sameSite:'Lax'}]);
  const candidate={...seed.candidates.find(c=>c.market==='us')!,issuer:fixture.snapshot.issuer};
  const workspace={version:1,profile:defaultProfile,candidates:[candidate,{...candidate,key:'XNAS:MSFT',ticker:'MSFT',name:'Synthetic other issuer',issuer:{...candidate.issuer,registryId:'0000789019'}}]};
  const finance={status:'ready',snapshot:fixture.snapshot};
  const screen={candidate,status:'PASS',finance,screenedAt:'2026-10-09T00:00:00Z',policyVersion:'usa-cvm-foundation-v1',decisions:[]};
  const jobs:unknown[]=[];const writes:string[]=[];
  let releaseFirstResearch!:()=>void;
  const firstResearchGate=new Promise<void>(resolve=>{releaseFirstResearch=resolve;});
  let holdFirstResearch=true;
  const documents:unknown[]=[];
  await page.route('**/api/corpus**',async route=>{
    if(route.request().url().includes('/handoff'))return route.fulfill({json:{url:'https://filinglens.example/#gpi='+'a'.repeat(64)}});
    if(route.request().method()==='POST'){const d=route.request().postDataJSON();expect(d.company).toBe(candidate.key);documents.push({id:'a'.repeat(64),path:`Synthetic/2025/10-K/${d.name}`,provenance:'user_upload'});return route.fulfill({status:201,json:{document:documents[0]}});}
    return route.fulfill({json:{documents}});
  });
  await page.route('**/api/foundation',async route=>{
    const req=route.request();if(req.method()==='POST'){
      const body=req.postDataJSON();writes.push(body.kind);
      if(body.kind==='research'&&holdFirstResearch){holdFirstResearch=false;await firstResearchGate;}
      const deepResearch=body.brief?{architecture:'bounded-research-manager-v1',promptVersion:'test-version',brief:body.brief,status:'model_disabled',plan:null,evidence:[],findings:[],gaps:['Full filing text is not connected.'],trace:[],modelCalls:0,stopReason:'model_disabled'}:null;
      if(body.brief){expect(body.candidateKey).toBe(candidate.key);expect(body.brief).toMatchObject({question:'What evidence challenges the growth thesis?',startYear:2024,endYear:2025,language:'en'});}
      const output=body.kind==='screen'?{kind:'screen',screens:[screen]}:{kind:'research',modelStatus:'disabled_or_no_evidence',report:{candidate,screen,draft:null,deepResearch,questions:{bull:['Which facts support growth?'],bear:['Which facts challenge growth?'],review:[]},valuation:{reason:'Valuation must be performed in FilingLens.'},limitations:['Human review required.']}};
      jobs.unshift({id:body.idempotencyKey,kind:body.kind,status:'complete',created_at:'2026-10-09T00:00:00Z',error_code:null,output});
      await route.fulfill({status:202,json:{id:body.idempotencyKey,status:'queued'}});
    }else if(req.method()==='PUT'){writes.push('profile');await route.fulfill({json:{workspace:req.postDataJSON()}});}
    else await route.fulfill({json:{workspace,jobs,integrations:{finance:'configured_read_attempts',researchModel:'disabled'}}});
  });
  const identityWarning='AAPL: a saved valuation was excluded because its canonical issuer no longer matches. Reimport a reviewed valuation for this issuer.';
  await page.route('**/api/integration/v1/portfolio-feedback',route=>route.fulfill({json:{runs:[{
    id:'550e8400-e29b-41d4-a716-446655440099',name:'Synthetic saved fixture',sharedAt:'2026-10-15T00:00:00Z',integrationWarnings:[identityWarning],
    analysis:{asOf:'2026-10-15',baseCurrency:'USD',holdings:[{symbol:'AAPL',shares:12,price:100,value:1200,weight:1,riskContribution:null,quoteCurrency:'USD',localPrice:100,fxRate:1,fxDate:'2026-10-15'}],
      metrics:{volatility:.2,var95:.03,maxDrawdown:-.1},returns:{lookbackReturn:.05,contributions:[{symbol:'AAPL',contribution:.05}]},
      valuationDiagnostics:[],allocation:null,feedback:[],warnings:[],fxSources:[],methodology:'Synthetic browser fixture.'}
  }],valuations:[{candidateKey:candidate.key,valuation:{valuationVersionId:appleAudit.valuationVersionId,method:'dcf',currency:'USD',impliedValuePerShare:'118.74',approvedAt:'2026-10-16T00:00:00Z'}}],providerConfigured:true}}));
  await page.route('**/api/integration/v1/valuation-audit?**',route=>route.fulfill({json:{status:'ready',audit:appleAudit}}));
  await page.route('**/api/workspace?**',route=>route.fulfill({json:{version:'investment-workspace.v1',candidateKey:new URL(route.request().url()).searchParams.get('company'),issuerId:'us:0000320193',financialOrigin:'https://filinglens.example',checkedAt:'2026-10-15T00:00:00.000Z',documents:{status:'empty',count:0,ruleVersion:'corpus-integrity.v1'},valuations:{status:'empty',count:0},portfolio:{status:'empty',count:0}}}));
  await page.goto('/');await expect(page.getByRole('heading',{name:'Investment workspace',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Candidates',exact:true}).click();await expect(page.getByRole('heading',{name:'Candidate watchlist'})).toBeVisible();
  await page.getByRole('button',{name:'Run screening'}).click();await expect(page.getByRole('heading',{name:'Durable job activity'})).toBeVisible();
  await page.getByRole('tab',{name:'Candidates',exact:true}).click();await expect(page.getByText('PASS',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Evidence pack',exact:true}).first().click();await page.getByRole('tab',{name:'Research',exact:true}).click();
  releaseFirstResearch();
  await expect(page.getByRole('heading',{name:'FilingLens evidence'})).toBeVisible();await expect(page.getByText('120 USD',{exact:true})).toBeVisible();
  await expect(page.getByText('Valuation must be performed in FilingLens.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:`/tmp/gpi-foundation-${width}.png`,fullPage:true});
  await page.getByRole('tab',{name:'Research Hub',exact:true}).click();
  await page.getByLabel('Library company').selectOption(candidate.key);
  await page.getByLabel('Import files',{exact:true}).setInputFiles({name:'evidence.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic source only. '.repeat(20))});
  await expect(page.getByRole('link',{name:'Synthetic/2025/10-K/evidence.txt'})).toBeVisible();
  await page.getByRole('button',{name:'Prepare FilingLens analysis for selected year'}).click();
  await expect(page.getByRole('link',{name:'Open document bundle in FilingLens (single use, ten minutes)'})).toHaveAttribute('href','https://filinglens.example/#gpi='+'a'.repeat(64));
  await page.getByLabel('Research company').selectOption(candidate.key);
  await page.getByLabel('Research question').fill('What evidence challenges the growth thesis?');
  await page.getByRole('button',{name:'Start focused research',exact:true}).click();
  await page.getByRole('tab',{name:'Research',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Managed research · model_disabled'})).toBeVisible();
  await expect(page.getByText('Full filing text is not connected.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.getByRole('tab',{name:'Investor profile',exact:true}).click();await page.getByLabel('Profile name').fill('New profile');
  await page.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.getByRole('status')).toContainText('Investor profile saved');
  expect(writes).toEqual(['screen','research','research','profile']);
  await page.getByRole('tab',{name:'Portfolio',exact:true}).click();
  await expect(page.getByRole('list',{name:'Integration review required'})).toContainText(identityWarning);
  // Source-backed Apple example: only HTTP transport is mocked; source values/quotes are frozen public issuer evidence.
  const evidenceButton=page.getByRole('button',{name:`Inspect ${candidate.key} reviewed valuation evidence`});
  await evidenceButton.focus();await page.keyboard.press('Enter');
  const evidenceDialog=page.getByRole('dialog',{name:`Saved valuation evidence · ${candidate.key}`});
  await expect(evidenceDialog).toBeVisible();
  await expect(evidenceDialog.getByRole('heading',{name:'Implied value per share: 118.74 USD/share'})).toBeFocused();
  for(const input of ['Equity value:','Enterprise value:','Y1 FCFF:','Y1 NOPAT:','Y1 EBIT:','Y1 revenue:','Annual base revenue:','Revenue:']){
    await evidenceDialog.getByRole('button',{name:new RegExp('^'+input.replaceAll('.', '\\.'))}).click();
  }
  await expect(evidenceDialog.getByRole('heading',{name:'Revenue: 416,161 USD millions'})).toBeVisible();
  await expect(evidenceDialog.getByRole('link',{name:'Open original source'})).toHaveAttribute('href','https://www.apple.com/newsroom/pdfs/fy2025-q4/FY25_Q4_Consolidated_Financial_Statements.pdf');
  await expect(evidenceDialog.locator('blockquote')).toContainText('416,161');
  await expect(evidenceDialog.locator('mark')).toHaveText('416,161');
  await page.screenshot({path:`/tmp/gpi-valuation-evidence-${width}.png`});
  const download=page.waitForEvent('download');await evidenceDialog.getByRole('button',{name:'Export saved evidence'}).click();
  const exportedFile=await download;expect(exportedFile.suggestedFilename()).toBe('GPI-valuation-evidence.json');
  const exported=JSON.parse(readFileSync((await exportedFile.path())!,'utf8'));
  expect(exported.lineage.nodes['dcf:implied_per_share'].value).toBe(118.74);
  expect(exported.lineage.nodes['actual:revenue:1']).toMatchObject({value:416161,sources:[{url:'https://www.apple.com/newsroom/pdfs/fy2025-q4/FY25_Q4_Consolidated_Financial_Statements.pdf'}]});
  await page.keyboard.press('Escape');await expect(evidenceDialog).not.toBeVisible();await expect(evidenceButton).toBeFocused();
  await page.route('**/api/integration/v1/valuation-audit?**',route=>route.fulfill({status:503,json:{status:'unavailable'}}));
  await evidenceButton.click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Evidence could not be verified');
  await expect(page.getByRole('dialog').locator('blockquote')).toHaveCount(0);await page.keyboard.press('Escape');

  await page.getByLabel('Portfolio holdings',{exact:true}).fill('AAPL,12');
  const consent=page.getByRole('checkbox',{name:'Share these holdings with Portfolio Risk Studio and retain the results in this GPI account.'});
  const calculate=page.getByRole('button',{name:'Calculate and save risk feedback'});
  for(const edit of [
    ()=>page.getByLabel('Portfolio holdings',{exact:true}).fill('AAPL,13'),
    ()=>page.getByLabel('Risk lookback').selectOption('3y'),
    ()=>page.getByLabel('Annual risk-free assumption (%)').fill('4'),
    ()=>page.getByLabel('Portfolio base currency').selectOption('BRL'),
    ()=>page.getByLabel('Portfolio name',{exact:true}).fill('Reviewed holdings'),
  ]){
    await consent.check();await expect(calculate).toBeEnabled();
    await edit();await expect(consent).not.toBeChecked();await expect(calculate).toBeDisabled();
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.getByRole('tab',{name:'Workspace',exact:true}).click();
  await page.getByRole('button',{name:'2. Financial analysis',exact:true}).click();
  const open=page.getByRole('button',{name:'Open financial analysis here'});await expect(open).toBeDisabled();
  await page.getByRole('checkbox',{name:'I verified this company’s CIK/CNPJ before opening financial analysis.'}).check();
  const version='flv1_'+'a'.repeat(64),imports:unknown[]=[];
  await page.route('**/api/integration/v1/handoff',route=>route.fulfill({json:{url:'https://filinglens.example/#integration=synthetic-test-only',expiresAt:'2026-10-15T02:00:00.000Z'}}));
  await page.route('https://filinglens.example/**',route=>route.fulfill({contentType:'text/html',body:`<button onclick='parent.postMessage({type:"filinglens.valuation.published.v1",candidateKey:"XNYS:OTHER",valuationVersionId:"${version}"},"http://127.0.0.1:3100")'>Wrong issuer</button><button onclick='parent.postMessage({type:"filinglens.valuation.published.v1",candidateKey:"${candidate.key}",valuationVersionId:"${version}"},"http://127.0.0.1:3100")'>Publish reviewed fixture</button>`}));
  await page.route('**/api/integration/v1/portfolio-feedback',route=>{if(route.request().method()==='POST'){imports.push(route.request().postDataJSON());return route.fulfill({json:{synchronized:true}});}return route.fulfill({json:{runs:[],valuations:[],providerConfigured:true}});});
  await open.click();
  const frame=page.frameLocator('iframe[title="FilingLens analysis for '+candidate.ticker+'"]');
  await frame.getByRole('button',{name:'Wrong issuer',exact:true}).click();expect(imports).toHaveLength(0);
  await frame.getByRole('button',{name:'Publish reviewed fixture',exact:true}).click();
  await expect(page.getByText('Reviewed valuation verified and synchronized. Review holdings before calculating risk.',{exact:true})).toBeVisible();
  expect(imports).toEqual([{action:'import_valuation',candidateKey:candidate.key,valuationVersionId:version}]);
  await page.getByRole('button',{name:'1. Sources',exact:true}).click();
  await page.getByRole('button',{name:'Prepare FilingLens analysis for selected year'}).click();
  await expect(page.getByText('Selected-year documents sent through the single-use handoff. Confirm the filing inside the financial panel.',{exact:true})).toBeVisible();
  await expect(page.locator('iframe[title="FilingLens analysis for '+candidate.ticker+'"]')).toHaveAttribute('src','https://filinglens.example/#gpi='+'a'.repeat(64));
  await page.getByRole('button',{name:'3. Portfolio',exact:true}).click();
  await page.getByRole('button',{name:'2. Financial analysis',exact:true}).click();
  await expect(page.locator('iframe[title="FilingLens analysis for '+candidate.ticker+'"]')).toHaveAttribute('src','https://filinglens.example/#gpi='+'a'.repeat(64));
  await page.getByLabel('Workspace company',{exact:true}).selectOption('XNAS:MSFT');
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button',{name:'2. Financial analysis',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'I verified this company’s CIK/CNPJ before opening financial analysis.'})).not.toBeChecked();
  await page.getByRole('button',{name:'1. Sources',exact:true}).click();
  await page.getByRole('button',{name:'Research this company',exact:true}).click();
  await expect(page.getByLabel('Research company')).toHaveValue('XNAS:MSFT');
  await page.getByRole('tab',{name:'Workspace',exact:true}).click();
  await expect(page.getByLabel('Workspace company',{exact:true})).toHaveValue('XNAS:MSFT');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
