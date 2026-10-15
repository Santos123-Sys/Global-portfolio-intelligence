import {describe,it,expect,vi,beforeEach} from 'vitest';
const m=vi.hoisted(()=>({auth:vi.fn(),workspace:vi.fn(),docs:vi.fn(),vals:vi.fn(),runs:vi.fn()}));
vi.mock('../src/lib/api-auth',()=>({authenticateRequest:m.auth}));
vi.mock('../src/lib/foundation/store',()=>({loadWorkspace:m.workspace}));
vi.mock('../src/lib/corpus/store',()=>({readDocuments:m.docs}));
vi.mock('../src/lib/integrations/portfolio-feedback',()=>({listValuations:m.vals,listPortfolioFeedback:m.runs}));
import {GET} from '../src/app/api/workspace/route';
import fixture from './fixtures/filinglens-public-finance-v1.json';
import seed from '../data/usa-cvm-universe.json';
const candidate={...seed.candidates.find(c=>c.market==='us')!,issuer:fixture.snapshot.issuer};
const req=()=>new Request('https://gpi.example/api/workspace?company='+candidate.key+'&owner=attacker');
beforeEach(()=>{vi.clearAllMocks();m.auth.mockResolvedValue({ok:true,auth:{userId:'session-owner',accountId:'session-account'}});m.workspace.mockResolvedValue({candidates:[candidate]});m.docs.mockResolvedValue([]);m.vals.mockResolvedValue([]);m.runs.mockResolvedValue([]);});
describe('unified overview authorization and partial failures',()=>{
 it('rejects unsigned requests before reads',async()=>{m.auth.mockResolvedValue({ok:false,response:Response.json({error:'unauthorized'},{status:401})});expect((await GET(req())).status).toBe(401);expect(m.workspace).not.toHaveBeenCalled();});
 it('uses only server-derived owner/account and reports empty separately from unavailable',async()=>{
  m.vals.mockRejectedValue(Error('database unavailable'));const r=await GET(req());expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({documents:{status:'empty',count:0},valuations:{status:'unavailable',count:null},portfolio:{status:'empty',count:0}});
  expect(m.docs).toHaveBeenCalledWith('session-owner',fixture.snapshot.issuer.jurisdiction+':'+fixture.snapshot.issuer.registryId,2000,2200);expect(m.vals).toHaveBeenCalledWith('session-owner','session-account');
 });
 it('reports corrupted derivatives as blocked without exposing data',async()=>{m.docs.mockRejectedValue(Error('document_text_integrity'));const body=await (await GET(req())).json();expect(body.documents).toMatchObject({status:'blocked',count:null});expect(JSON.stringify(body)).not.toContain('text_content');});
 it('does not inspect companies outside the workspace',async()=>{m.workspace.mockResolvedValue({candidates:[]});expect((await GET(req())).status).toBe(404);expect(m.docs).not.toHaveBeenCalled();});
});
