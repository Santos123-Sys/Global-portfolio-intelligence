import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({access:vi.fn(),read:vi.fn(),query:vi.fn()}));
vi.mock('../src/lib/integrations/analysis-access',()=>({analysisAccessAllowed:mocks.access}));
vi.mock('../src/lib/corpus/store',()=>({readDocuments:mocks.read}));
vi.mock('../src/lib/foundation/store',()=>({sql:()=>mocks.query,loadWorkspace:vi.fn()}));
import {POST} from '../src/app/api/corpus/handoff/route';
const req=()=>new Request('https://gpi.example/api/corpus/handoff',{method:'POST',headers:{authorization:'Bearer '+'synthetic-corpus-service-'.repeat(2),'content-type':'application/json'},body:JSON.stringify({ticket:'a'.repeat(64)})});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('FILINGLENS_CORPUS_TOKEN','synthetic-corpus-service-'.repeat(2));mocks.query.mockResolvedValue([{integration_ticket:'synthetic-bound-handoff',owner_id:'synthetic-owner',issuer_id:'us:0000320193',start_year:2025,end_year:2025}]);});
afterEach(()=>vi.unstubAllEnvs());
it('never reads private documents when the initiating session or membership was revoked',async()=>{
 mocks.access.mockResolvedValue(false);expect((await POST(req())).status).toBe(403);
 expect(mocks.access).toHaveBeenCalledWith('synthetic-bound-handoff');expect(mocks.read).not.toHaveBeenCalled();
});
it('serves scoped documents only after current delegation is accepted',async()=>{
 mocks.access.mockResolvedValue(true);mocks.read.mockResolvedValue([{text:'Synthetic evidence only',metadata:{id:'example',path:'fixture',company:'Synthetic',provenance:'user_upload'}}]);
 expect((await POST(req())).status).toBe(200);expect(mocks.read).toHaveBeenCalledWith('synthetic-owner','us:0000320193',2025,2025);
});
