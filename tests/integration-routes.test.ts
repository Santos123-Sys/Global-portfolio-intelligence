import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({
  auth:vi.fn(),origin:vi.fn(),reviews:vi.fn(),review:vi.fn(),workspace:vi.fn(),
}));
vi.mock('../src/lib/api-auth',()=>({authenticateRequest:mocks.auth}));
vi.mock('../src/lib/auth',()=>({assertSameOrigin:mocks.origin}));
vi.mock('../src/lib/integrations/review-store',()=>({
  listReviews:mocks.reviews,reviewResearch:mocks.review,
  HandoffError:class extends Error {code='idempotency_conflict';},
}));
vi.mock('../src/lib/foundation/store',()=>({loadWorkspace:mocks.workspace}));
import { GET as reviewGET,POST as reviewPOST } from '../src/app/api/integration/v1/reviews/route';
import { GET as registryGET } from '../src/app/api/integration/v1/registry/route';
import { GET as valuationGET } from '../src/app/api/integration/v1/valuation/route';
import { GET as portfolioGET } from '../src/app/api/integration/v1/portfolio/route';
const id='550e8400-e29b-41d4-a716-446655440000';
const account='550e8400-e29b-41d4-a716-446655440001';
const reviewer='550e8400-e29b-41d4-a716-446655440002';
const request=(method='GET')=>new Request('https://gpi.example/api/integration/v1/reviews',
  {method,headers:{origin:'https://gpi.example','content-type':'application/json'},
   ...(method==='POST'?{body:'{}'}:{})});
beforeEach(()=>{
  vi.clearAllMocks();
  vi.stubEnv('FILINGLENS_VALUATION_READ_ENABLED','false');
  vi.stubEnv('PORTFOLIO_RISK_READ_ENABLED','false');
  mocks.auth.mockResolvedValue({ok:true,auth:{userId:id,accountId:account,actorUserId:reviewer,role:'analyst'}});
  mocks.origin.mockImplementation(()=>undefined);
  mocks.reviews.mockResolvedValue([]);
  mocks.review.mockResolvedValue({review:{reviewId:id},reused:false,delivered:false});
  mocks.workspace.mockResolvedValue({candidates:[]});
});
describe('same-origin, account-scoped GPI integration routes',()=>{
  it.each([reviewGET,reviewPOST,registryGET,valuationGET,portfolioGET])('fails unauthorized requests before querying data',async handler=>{
    mocks.auth.mockResolvedValue({ok:false,response:Response.json({error:'unauthorized'},{status:401})});
    expect((await handler(request('GET'))).status).toBe(401);
    expect(mocks.reviews).not.toHaveBeenCalled();
  });
  it('passes signed-in owner and reviewer IDs only from session',async()=>{
    const res=await reviewPOST(request('POST'));
    expect(res.status).toBe(201);
    expect(mocks.review).toHaveBeenCalledWith(id,account,reviewer,{});
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('blocks viewer mutations before database writes',async()=>{
    mocks.auth.mockResolvedValue({ok:true,auth:{userId:id,accountId:account,actorUserId:reviewer,role:'viewer'}});
    expect((await reviewPOST(request('POST'))).status).toBe(403);
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it('blocks cross-origin mutations before database writes',async()=>{
    mocks.origin.mockImplementation(()=>{throw Error('wrong origin');});
    expect((await reviewPOST(request('POST'))).status).toBe(403);
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it('only reads reviews and identities from authenticated tenant',async()=>{
    expect((await reviewGET(request())).status).toBe(200);
    expect(mocks.reviews).toHaveBeenCalledWith(id);
    expect((await registryGET(request())).status).toBe(200);
    expect(mocks.workspace).toHaveBeenCalledWith(id);
  });
  it('keeps valuation and portfolio risk read endpoints disabled by default',async()=>{
    expect((await valuationGET(request())).status).toBe(200);
    expect((await portfolioGET(request())).status).toBe(200);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
});
