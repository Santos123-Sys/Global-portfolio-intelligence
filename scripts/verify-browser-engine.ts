import assert from 'node:assert/strict';
import {ResearchBrowser,FIXTURE_ORIGIN,FIXTURE_QUOTE,captureEvidence} from '../src/lib/browser/engine';
const results=[];
for(let trial=0;trial<3;trial++){
 const started=performance.now(),engine=new ResearchBrowser([FIXTURE_ORIGIN],true);
 try{
  const initial=await engine.open(FIXTURE_ORIGIN+'/');
  assert.ok(Buffer.from(initial.image,'base64').length>1000);
  let report=await engine.execute({kind:'link',index:0},initial.id);
  assert.ok(report.text.includes(FIXTURE_QUOTE));assert.notEqual(report.id,initial.id);assert.equal(report.tabId,initial.tabId);
  await assert.rejects(engine.execute({kind:'link',index:0},initial.id),/stale_observation/);
  const e=captureEvidence(report,FIXTURE_QUOTE,{issuerId:'us:0000000001',year:2025,originalUrl:initial.url},'fixture-action');
  assert.equal(e.text,FIXTURE_QUOTE);assert.equal(e.finalUrl,FIXTURE_ORIGIN+'/report');
  await assert.rejects(engine.execute({kind:'navigate',url:'https://127.0.0.1/'},report.id));
  await assert.rejects(engine.execute({kind:'navigate',url:FIXTURE_ORIGIN+'/signin'},report.id),/private_signin_disabled/);
  await assert.rejects(engine.execute({kind:'capture',quote:'Invented evidence that is not on the page.'},report.id),/quote_not_found/);
  const originalTab=report.tabId;
  const second=await engine.execute({kind:'open_tab',url:FIXTURE_ORIGIN+'/report'},report.id);
  assert.equal(second.tabs?.length,2);assert.notEqual(second.tabId,originalTab);
  const third=await engine.execute({kind:'open_tab',url:FIXTURE_ORIGIN+'/report'},second.id);
  await assert.rejects(engine.execute({kind:'open_tab',url:FIXTURE_ORIGIN+'/report'},third.id),/tab_budget/);
  report=await engine.execute({kind:'select_tab',tabId:originalTab},third.id);assert.equal(report.tabId,originalTab);
  const frame=await engine.frame();assert.ok(frame);assert.equal(frame.observationId,report.id);assert.notEqual(frame.id,report.id);
  await assert.rejects(engine.execute({kind:'navigate',url:FIXTURE_ORIGIN+'/sensitive'},report.id),/private_or_interactive_page_unsupported/);
  assert.equal(await engine.frame(),null);
  results.push({trial,success:true,durationMs:Math.round(performance.now()-started),frameBytes:Buffer.from(report.image,'base64').length});
 }finally{await engine.close();}
}
console.log(JSON.stringify({kind:'real-chromium-controlled-fixture',trials:results,providerModelVerified:false},null,2));
