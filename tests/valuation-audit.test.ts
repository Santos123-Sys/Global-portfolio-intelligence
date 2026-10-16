import {beforeEach, describe, expect, it, vi} from 'vitest';
import {readValuationAudit} from '../src/lib/integrations/external-readers';
import type {FinancialLineage, ValuationAudit} from '../src/lib/integrations/valuation-lineage';
const mocks = vi.hoisted(() => ({auth: vi.fn(), workspace: vi.fn(), valuations: vi.fn()}));
vi.mock('../src/lib/api-auth', () => ({authenticateRequest: mocks.auth}));
vi.mock('../src/lib/foundation/store', () => ({loadWorkspace: mocks.workspace}));
vi.mock('../src/lib/integrations/portfolio-feedback', () => ({listValuations: mocks.valuations}));
import {GET} from '../src/app/api/integration/v1/valuation-audit/route';
const owner = '550e8400-e29b-41d4-a716-446655440000', account = '550e8400-e29b-41d4-a716-446655440001';
const version = 'flv1_' + 'a'.repeat(64), issuer = 'us:0000320193';
const candidate = {key: 'XNAS:AAPL', ticker: 'AAPL', name: 'Apple', exchange: 'XNAS', market: 'us',
  identitySourceUrl: 'https://www.sec.gov/files/company_tickers_exchange.json', issuer: {jurisdiction: 'us', registryId: '0000320193'}};
const graph = (): FinancialLineage => ({schemaVersion: 'financial-lineage.v1', issuer: {name: 'Apple', ticker: 'AAPL', registryId: '0000320193'},
  accountingBasis: 'us_gaap', scope: 'consolidated', calculationVersion: 'fcff-v2', valuationDate: '2026-10-16', nodes: {
    'dcf:implied_per_share': {id: 'dcf:implied_per_share', label: 'Value per share', value: 120.3, unit: 'USD/share', period: '2026-10-16',
      classification: 'calculated_metric', status: 'calculated', inputs: [], sources: [], retrievalMethod: 'Deterministic calculation', checks: [], limitations: []},
  }});
const audit = (): ValuationAudit => ({schemaVersion: 'valuation-audit.v1', valuationVersionId: version, issuerId: issuer, lineage: graph()});
const config = {baseUrl: 'https://filing.example/', token: 't'.repeat(40), workspaceId: account};
const req = (extra = '') => new Request(`https://gpi.example/api/integration/v1/valuation-audit?candidateKey=XNAS:AAPL&valuationVersionId=${version}${extra}`);
beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllGlobals();
  vi.stubEnv('FILINGLENS_VALUATION_READ_ENABLED', 'true'); vi.stubEnv('FILINGLENS_API_URL', config.baseUrl); vi.stubEnv('FILINGLENS_VALUATION_READ_API_TOKEN', config.token);
  mocks.auth.mockResolvedValue({ok: true, auth: {userId: owner, accountId: account, role: 'viewer'}});
  mocks.workspace.mockResolvedValue({candidates: [candidate]});
  mocks.valuations.mockResolvedValue([{candidateKey: candidate.key, valuation: {valuationVersionId: version, issuerId: issuer, method: 'dcf', currency: 'USD', impliedValuePerShare: '120.3'}}]);
});
describe('saved valuation audit authorization and provider contract', () => {
  it('rejects anonymous reads before any storage or provider request', async () => {
    mocks.auth.mockResolvedValue({ok: false, response: Response.json({error: 'unauthorized'}, {status: 401})});
    expect((await GET(req())).status).toBe(401); expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.valuations).not.toHaveBeenCalled();
  });
  it('derives owner and workspace from the session and sends service credentials only to FilingLens', async () => {
    const provider = vi.fn(async () => Response.json(audit())); vi.stubGlobal('fetch', provider);
    const response = await GET(req('&workspaceId=attacker&owner=attacker'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.valuations).toHaveBeenCalledWith(owner, account); expect(mocks.workspace).toHaveBeenCalledWith(owner);
    const [url, init] = provider.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe(`https://filing.example/api/integration/v1/valuations/${version}/audit`);
    expect(init.headers).toMatchObject({'X-Workspace-Id': account, Authorization: 'Bearer ' + config.token});
    expect(JSON.stringify(await response.json())).not.toContain(config.token);
  });
  it('does not request a valuation absent from the current account or current company list', async () => {
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    mocks.valuations.mockResolvedValue([]); expect((await GET(req())).status).toBe(404);
    mocks.workspace.mockResolvedValue({candidates: []}); expect((await GET(req())).status).toBe(404); expect(provider).not.toHaveBeenCalled();
  });
  it('blocks a saved valuation after canonical issuer identity changes', async () => {
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    mocks.workspace.mockResolvedValue({candidates: [{...candidate, issuer: {jurisdiction: 'us', registryId: '0000789019'}}]});
    expect((await GET(req())).status).toBe(409); expect(provider).not.toHaveBeenCalled();
  });
  it('reports provider failures without exposing a partial graph', async () => {
    vi.stubGlobal('fetch', async () => new Response('private diagnostic', {status: 503}));
    const response = await GET(req()); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({status: 'unavailable', reason: 'provider_unavailable'});
  });
  it('rejects a graph contradicting the saved per-share number', async () => {
    const wrong = audit(); wrong.lineage.nodes['dcf:implied_per_share'].value = 999;
    vi.stubGlobal('fetch', async () => Response.json(wrong));
    expect((await GET(req())).status).toBe(503);
  });
  it('rejects wrong versions, issuers and inner registry identities', async () => {
    for (const wrong of [ {...audit(), valuationVersionId: 'flv1_' + 'b'.repeat(64)}, {...audit(), issuerId: 'us:0000789019'},
      {...audit(), lineage: {...graph(), issuer: {...graph().issuer, registryId: '0000789019'}}}])
      await expect(readValuationAudit(version, issuer, {...config, fetch: async () => Response.json(wrong)})).rejects.toThrow('identity_mismatch');
  });
  it('requires a server workspace and rejects oversized, cyclic or dangling graphs and unsafe links', async () => {
    await expect(readValuationAudit(version, issuer, {...config, workspaceId: undefined})).rejects.toThrow('invalid_configuration');
    await expect(readValuationAudit(version, issuer, {...config, fetch: async () => new Response('x'.repeat(512001), {headers: {'content-type': 'application/json'}})})).rejects.toThrow('response_too_large');
    const cyclic = audit(); cyclic.lineage.nodes['dcf:implied_per_share'].inputs = ['dcf:implied_per_share'];
    const dangling = audit(); dangling.lineage.nodes['dcf:implied_per_share'].inputs = ['missing'];
    const unsafe = audit(); unsafe.lineage.nodes['dcf:implied_per_share'].sources = [{section: 'Source', url: 'https://source.example/?token=private'}];
    for (const wrong of [cyclic, dangling, unsafe])
      await expect(readValuationAudit(version, issuer, {...config, fetch: async () => Response.json(wrong)})).rejects.toThrow('invalid_contract');
  });
});
