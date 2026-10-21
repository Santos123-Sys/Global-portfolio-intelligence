import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),origin:vi.fn(),read:vi.fn(),catalog:vi.fn()}));
vi.mock('../src/lib/api-auth',()=>({authenticateRequest:mocks.auth}));
vi.mock('../src/lib/auth',()=>({assertSameOrigin:mocks.origin}));
vi.mock('../src/lib/market/brazil-market-catalog',()=>({brazilMarketCatalog:mocks.catalog}));
vi.mock('../src/lib/integrations/brazil-data',async importOriginal=>({...await importOriginal<object>(),readBrazilFundamentals:mocks.read}));
import {GET,POST} from '../src/app/api/integration/v1/brazil-data/route';
const request=(body:unknown)=>new Request('https://gpi.example/api/integration/v1/brazil-data',{method:'POST',headers:{'content-type':'application/json',origin:'https://gpi.example'},body:JSON.stringify(body)});
beforeEach(()=>{
 vi.clearAllMocks();mocks.auth.mockResolvedValue({ok:true,auth:{userId:'owner'}});mocks.origin.mockImplementation(()=>undefined);
 mocks.read.mockResolvedValue({schemaVersion:'cvm-screen.v1'});
});
describe('Brazil data routes',()=>{
 it.each([GET,POST])('rejects anonymous requests before acquiring data',async handler=>{
  mocks.auth.mockResolvedValue({ok:false,response:Response.json({error:'unauthorized'},{status:401})});
  expect((await handler(request({operation:'screen'}))).status).toBe(401);
  expect(mocks.read).not.toHaveBeenCalled();expect(mocks.catalog).not.toHaveBeenCalled();
 });
 it('rejects cross-origin and unsupported point-in-time queries before acquisition',async()=>{
  mocks.origin.mockImplementationOnce(()=>{throw Error('origin');});
  expect((await POST(request({operation:'screen'}))).status).toBe(403);
  expect((await POST(request({operation:'screen',asOf:'2020-01-01'}))).status).toBe(400);
  expect(mocks.read).not.toHaveBeenCalled();
 });
 it('returns authenticated reads without caching or leaking upstream failure details',async()=>{
  const result=await POST(request({operation:'screen'}));expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('no-store');
  mocks.read.mockRejectedValueOnce(Error('secret upstream detail'));
  const failure=await POST(request({operation:'screen'}));expect(failure.status).toBe(503);
  expect(await failure.text()).not.toContain('secret');
 });
});
