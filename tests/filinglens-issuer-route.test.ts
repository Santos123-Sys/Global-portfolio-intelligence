import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateRequest } from '@/lib/api-auth';
import { loadWorkspace } from '@/lib/foundation/store';
import { loadFilingLensFinance } from '@/lib/integrations/filinglens-client';
import { GET } from '@/app/api/integrations/filinglens/issuer/route';

vi.mock('@/lib/api-auth', () => ({ authenticateRequest: vi.fn() }));
vi.mock('@/lib/foundation/store', () => ({ loadWorkspace: vi.fn() }));
vi.mock('@/lib/integrations/filinglens-client', () => ({ loadFilingLensFinance: vi.fn() }));

const candidate = {
  key: 'XNAS:AAPL', exchange: 'XNAS', ticker: 'AAPL',
  issuer: { jurisdiction: 'us', registryId: '0000320193' },
};
const request = (key = 'XNAS:AAPL') =>
  new Request('https://gpi.example/api/integrations/filinglens/issuer?candidateKey=' + encodeURIComponent(key));
const ready = {
  status: 'ready' as const,
  snapshot: { issuer: { jurisdiction: 'us', registryId: '0000320193' }, facts: [], limitations: [] },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, auth: { userId: 'owner-a' } } as never);
  vi.mocked(loadWorkspace).mockResolvedValue({ candidates: [candidate] } as never);
  vi.mocked(loadFilingLensFinance).mockResolvedValue(ready as never);
});

describe('workspace-scoped FilingLens evidence preview', () => {
  it('rejects unauthenticated requests before touching the watchlist', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: false, response: new Response('unauthorized', { status: 401 }) } as never);
    expect((await GET(request())).status).toBe(401);
    expect(loadWorkspace).not.toHaveBeenCalled();
    expect(loadFilingLensFinance).not.toHaveBeenCalled();
  });
  it('accepts only one bounded candidate key', async () => {
    const response = await GET(new Request('https://gpi.example/api/integrations/filinglens/issuer?candidateKey=XNAS:AAPL&candidateKey=XBRA:BAD'));
    expect(response.status).toBe(400);
    expect(loadWorkspace).not.toHaveBeenCalled();
  });
  it('blocks candidates not present in the authenticated workspace', async () => {
    expect((await GET(request('XNAS:MSFT'))).status).toBe(404);
    expect(loadWorkspace).toHaveBeenCalledWith('owner-a');
    expect(loadFilingLensFinance).not.toHaveBeenCalled();
  });
  it('returns verified connector facts without recomputing values', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(loadFilingLensFinance).toHaveBeenCalledWith({ ticker: 'AAPL', exchange: 'XNAS' });
    await expect(response.json()).resolves.toMatchObject({ candidateKey: 'XNAS:AAPL', finance: { status: 'ready', snapshot: { issuer: candidate.issuer } } });
  });
  it('fails closed when a saved candidate issuer disagrees with verified finance identity', async () => {
    vi.mocked(loadFilingLensFinance).mockResolvedValue({ status: 'ready', snapshot: { issuer: { jurisdiction: 'us', registryId: '0000789019' } } } as never);
    const response = await GET(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ finance: { status: 'unavailable', reason: 'issuer_identity_conflict' } });
  });
  it('shows upstream unavailable without manufacturing financial numbers', async () => {
    vi.mocked(loadFilingLensFinance).mockResolvedValue({ status: 'unavailable', reason: 'snapshot_not_found' } as never);
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ finance: { status: 'unavailable', reason: 'snapshot_not_found' } });
  });
  it('does not leak internal store or network errors', async () => {
    vi.mocked(loadWorkspace).mockRejectedValue(new Error('private database URL'));
    const response = await GET(request());
    expect(response.status).toBe(503);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain('private database');
  });
});
