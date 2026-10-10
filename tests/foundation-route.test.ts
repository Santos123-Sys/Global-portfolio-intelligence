import { describe,it,expect,vi,beforeEach } from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),origin:vi.fn(),load:vi.fn(),jobs:vi.fn(),save:vi.fn(),queue:vi.fn()}));
vi.mock('../src/lib/api-auth',()=>({authenticateRequest:mocks.auth}));
vi.mock('../src/lib/auth',()=>({assertSameOrigin:mocks.origin}));
vi.mock('../src/lib/foundation/store',()=>({loadWorkspace:mocks.load,listJobs:mocks.jobs,saveWorkspace:mocks.save,enqueue:mocks.queue,QueueError:class extends Error{code='queue_limit';}}));
import { GET,PUT,POST } from '../src/app/api/foundation/route';
const userId='550e8400-e29b-41d4-a716-446655440000';
const req=()=>new Request('https://app.example/api/foundation',{method:'POST',headers:{'content-type':'application/json',origin:'https://app.example'},body:'{}'});
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({ok:true,auth:{userId,role:'owner'}});mocks.origin.mockImplementation(()=>undefined);mocks.load.mockResolvedValue({});mocks.jobs.mockResolvedValue([]);mocks.queue.mockResolvedValue({id:'job',status:'queued'});});
describe('foundation account and mutation boundaries',()=>{
  it.each([GET,PUT,POST])('rejects unauthenticated requests before storage',async handler=>{mocks.auth.mockResolvedValue({ok:false,response:Response.json({error:'Unauthorized'},{status:401})});expect((await handler(req())).status).toBe(401);expect(mocks.queue).not.toHaveBeenCalled();expect(mocks.load).not.toHaveBeenCalled();});
  it('uses the authorized tenant for every read',async()=>{const res=await GET(req());expect(res.status).toBe(200);expect(mocks.load).toHaveBeenCalledWith(userId);expect(mocks.jobs).toHaveBeenCalledWith(userId);expect(res.headers.get('cache-control')).toBe('no-store');});
  it.each([PUT,POST])('rejects cross-origin writes',async handler=>{mocks.origin.mockImplementation(()=>{throw new Error('CSRF');});expect((await handler(req())).status).toBe(403);expect(mocks.queue).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();});
  it.each([PUT,POST])('rejects viewer writes',async handler=>{mocks.auth.mockResolvedValue({ok:true,auth:{userId,role:'viewer'}});expect((await handler(req())).status).toBe(403);});
  it('returns queued acknowledgement, never a fabricated result',async()=>{expect((await POST(req())).status).toBe(202);expect(mocks.queue).toHaveBeenCalledWith(userId,{});});
  it('sanitizes database failures',async()=>{mocks.load.mockRejectedValue(new Error('postgres://secret:credential'));const res=await GET(req());expect(res.status).toBe(503);expect(await res.text()).not.toContain('credential');});
});
