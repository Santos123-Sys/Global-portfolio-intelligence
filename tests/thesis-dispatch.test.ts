import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({select:vi.fn(),transaction:vi.fn(),start:vi.fn(),load:vi.fn(),events:[] as string[]}));
vi.mock('../src/lib/env',()=>({getEnv:()=>({DISCOVERY_UNIVERSE_LIMIT:2000,DISCOVERY_RESEARCH_BUDGET:40})}));
vi.mock('../src/lib/db',()=>({db:{select:mocks.select,transaction:mocks.transaction}}));
vi.mock('../src/lib/discovery-provider',()=>({loadDiscoveryUniverse:mocks.load,enrichDiscoveryIssuerSources:async(records:unknown[])=>records}));
vi.mock('../src/lib/agent-config',()=>({getActiveAgentCustomization:async()=>undefined}));
vi.mock('../src/lib/integrations/agentic-client',()=>({startExternalDiscoveryRun:mocks.start,startExternalAgenticRun:vi.fn()}));
import {startDiscoveryRunForOwner} from '../src/lib/discovery-workflow';
const versionId='11111111-1111-4111-8111-111111111111';const portfolioId='22222222-2222-4222-8222-222222222222';
function query(rows:unknown[]){const p=Promise.resolve(rows);return Object.assign(p,{from:()=>p,innerJoin:()=>p,where:()=>p,orderBy:()=>p,limit:()=>p});}
beforeEach(()=>{
 vi.clearAllMocks();mocks.events=[];
 mocks.select.mockReturnValue(query([])).mockReturnValueOnce(query([{id:versionId,versionNumber:1,criteriaJson:{version:1,portfolios:[{role:'swiss_quality',currency:'CHF',objective:'Quality',inclusionCriteria:[],exclusionCriteria:[]}],globalConstraints:[]}}])).mockReturnValueOnce(query([{id:portfolioId,name:'Swiss',portfolioType:'swiss_quality',baseCurrency:'CHF'}]));
 mocks.load.mockImplementation(async()=>{mocks.events.push('provider');return {provider:'fixture',records:[{ticker:'AAA',exchange:'XSWX',companyName:'Example',currency:'CHF',country:null,sector:null,industry:null,assetType:'Common Stock',observedAt:'2026-09-27T00:00:00Z',provider:'fixture',sourceUrl:'https://example.test',attributes:{}}]};});
});
describe('Discovery dispatch against active snapshot',()=>{
 it('rechecks under lock after provider loading and refuses superseded versions',async()=>{
  mocks.transaction.mockImplementation(async cb=>cb({execute:async()=>mocks.events.push('lock'),select:()=>query([])}));
  await expect(startDiscoveryRunForOwner({ownerId:'owner',thesisVersionId:versionId})).rejects.toThrow(/changed before Discovery/);
  expect(mocks.events).toEqual(['provider','lock']);expect(mocks.start).not.toHaveBeenCalled();
 });
 it('reuses an existing nonfailed run under the same lock',async()=>{
  const rows=[[{id:versionId}],[{id:'existing',status:'completed'}]];
  mocks.transaction.mockImplementation(async cb=>cb({execute:async()=>mocks.events.push('lock'),select:()=>query(rows.shift()??[])}));
  const result=await startDiscoveryRunForOwner({ownerId:'owner',thesisVersionId:versionId,reuseExistingForThesis:true});
  expect(result).toMatchObject({reused:true,run:{id:'existing'}});expect(mocks.start).not.toHaveBeenCalled();
 });
});

it('rejects approval from a superseded thesis while holding the owner lock', async () => {
 const {approveCandidateForAnalysis}=await import('../src/lib/discovery-workflow');
 mocks.select.mockReset().mockReturnValue(query([{candidate:{id:'candidate',decision:'pending',workflowStatus:'awaiting_review',externalAnalysisRunId:null},portfolio:{id:portfolioId},run:{thesisVersionId:versionId}}]));
 const update=vi.fn();
 mocks.transaction.mockImplementation(async cb=>cb({execute:async()=>mocks.events.push('lock'),select:()=>query([]),update}));
 await expect(approveCandidateForAnalysis('owner','candidate','owner',{decisionReason:'Review',expectedHoldingPeriod:'3 years',valuationView:'Unknown',principalRisk:'Cycle',invalidationTrigger:'Margins'})).rejects.toThrow(/thesis has changed/);
 expect(mocks.events).toEqual(['lock']);expect(update).not.toHaveBeenCalled();
});
