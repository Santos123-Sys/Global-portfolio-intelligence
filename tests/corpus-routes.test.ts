import { beforeEach,describe,it,expect,vi } from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),origin:vi.fn(),list:vi.fn(),download:vi.fn(),remove:vi.fn(),workspace:vi.fn()}));
vi.mock('../src/lib/api-auth',()=>({authenticateRequest:mocks.auth}));
vi.mock('../src/lib/auth',()=>({assertSameOrigin:mocks.origin}));
vi.mock('../src/lib/corpus/store',()=>({listDocuments:mocks.list,downloadDocument:mocks.download,deleteDocument:mocks.remove,saveDocument:vi.fn()}));
vi.mock('../src/lib/foundation/store',()=>({loadWorkspace:mocks.workspace,sql:vi.fn()}));
import { GET,POST,DELETE } from '../src/app/api/corpus/route';
import { POST as slides } from '../src/app/api/corpus/presentation/route';
const owner='550e8400-e29b-41d4-a716-446655440000';
const request=()=>new Request('https://app.example/api/corpus?company=XNAS:TEST',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({ok:true,auth:{userId:owner,role:'owner'}});mocks.origin.mockImplementation(()=>{});mocks.workspace.mockResolvedValue({candidates:[{key:'XNAS:TEST',issuer:{jurisdiction:'us',registryId:'0000000001'}}]});mocks.list.mockResolvedValue([]);mocks.download.mockResolvedValue(null);});
describe('corpus HTTP ownership and mutation controls',()=>{
  it.each([GET,POST,DELETE,slides])('rejects unsigned users',async handler=>{mocks.auth.mockResolvedValue({ok:false,response:Response.json({error:'Unauthorized'},{status:401})});expect((await handler(request())).status).toBe(401);expect(mocks.list).not.toHaveBeenCalled();});
  it.each([POST,DELETE,slides])('rejects viewer writes',async handler=>{mocks.auth.mockResolvedValue({ok:true,auth:{userId:owner,role:'viewer'}});expect((await handler(request())).status).toBe(403);});
  it('derives owner scope from the session, never the URL',async()=>{await GET(new Request('https://app.example/api/corpus?company=XNAS:TEST&owner=someone-else'));expect(mocks.list).toHaveBeenCalledWith(owner,'us:0000000001');});
  it('does not disclose another owner original',async()=>{const res=await GET(new Request('https://app.example/api/corpus?download='+'a'.repeat(64)));expect(res.status).toBe(404);expect(mocks.download).toHaveBeenCalledWith(owner,'a'.repeat(64));});
  it('blocks cross-origin import before extraction',async()=>{mocks.origin.mockImplementation(()=>{throw new Error();});expect((await POST(request())).status).toBe(403);});
});
