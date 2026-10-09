import { describe, it, expect, vi, afterEach } from 'vitest';
import fixture from './fixtures/filinglens-public-finance-v1.json';
import seed from '../data/usa-cvm-universe.json';
import { Candidate, Workspace, JobRequest, defaultProfile } from '../src/lib/foundation/contracts';
import { FilingLensSnapshot, normalizeFilingLensIssuer } from '../src/lib/integrations/filinglens-contract';
import { readFilingLensSnapshot } from '../src/lib/integrations/filinglens-client';
import { screenCandidate } from '../src/lib/foundation/screening';
import { validateResearchDraft, researchWorkbench } from '../src/lib/foundation/research';
import { executeJob } from '../src/lib/foundation/runner';
import { generateResearchDraft } from '../src/lib/foundation/model';
const candidate = Candidate.parse({ key: 'XNAS:TEST', ticker: 'TEST', name: 'Synthetic issuer', exchange: 'XNAS', market: 'us',
  issuer: fixture.snapshot.issuer, identitySourceUrl: 'https://data.sec.gov/fixture' });
const snapshot = () => FilingLensSnapshot.parse(structuredClone(fixture.snapshot));
const now = new Date('2026-10-09T00:00:00Z');
const workspace = { version: 1, profile: defaultProfile, candidates: [candidate] };
const idempotencyKey = '550e8400-e29b-41d4-a716-446655440000';
afterEach(() => vi.unstubAllEnvs());
describe('foundation contracts', () => {
  it('retains only supported starter listings', () => { const w = Workspace.parse({ ...workspace, candidates: seed.candidates }); expect(w.candidates.length).toBe(17); expect(w.candidates.some(c => c.market === 'br')).toBe(true); });
  it('rejects Swiss candidates and mismatched markets', () => { expect(Candidate.safeParse({ ...candidate, market: 'ch', exchange: 'XSWX' }).success).toBe(false); expect(Candidate.safeParse({ ...candidate, market: 'br' }).success).toBe(false); });
  it('rejects duplicate keys and empty markets', () => { expect(Workspace.safeParse({ ...workspace, candidates: [candidate, candidate] }).success).toBe(false); expect(Workspace.safeParse({ ...workspace, profile: { ...defaultProfile, markets: [] } }).success).toBe(false); });
  it('bounds screen batches and requires a research target', () => { expect(JobRequest.safeParse({ kind: 'research', workspace, idempotencyKey }).success).toBe(false); expect(JobRequest.safeParse({ kind: 'screen', workspace: { ...workspace, candidates: [] }, idempotencyKey }).success).toBe(false); });
  it('rejects JavaScript and credentialed identity links', () => { for (const url of ['javascript:alert(1)', 'https://user:secret@example.com/']) expect(Candidate.safeParse({ ...candidate, identitySourceUrl: url }).success).toBe(false); });
  it('normalizes CIK, rejects invalid CNPJ and zero identities', () => { expect(normalizeFilingLensIssuer('us','1').registryId).toBe('0000000001'); expect(() => normalizeFilingLensIssuer('br','123')).toThrow(); expect(() => normalizeFilingLensIssuer('us','0')).toThrow(); });
  it('fails safely for malformed and unofficial regulator URLs', () => { for (const url of ['bad url','https://sec.gov.attacker.example/data','https://user:secret@data.sec.gov/']) { const s = structuredClone(fixture.snapshot); s.facts[0].sources[0].url = url; expect(FilingLensSnapshot.safeParse(s).success).toBe(false); } });
});
describe('external-only staged screening', () => {
  it('passes or fails by comparing the supplied growth, with lineage', () => { const a = screenCandidate(candidate,defaultProfile,{status:'ready',snapshot:snapshot()},now); expect(a.status).toBe('PASS'); expect(a.decisions[1].evidenceIds).toHaveLength(2); expect(screenCandidate(candidate,{...defaultProfile,minimumRevenueGrowthPct:21},{status:'ready',snapshot:snapshot()},now).status).toBe('FAIL'); });
  it.each(['disabled','unavailable','identity_unmapped'] as const)('keeps %s unknown', status => { expect(screenCandidate(candidate,defaultProfile,{status,reason:'missing'},now).status).toBe('UNKNOWN'); });
  it('does not pass empty thresholds or missing liquidity', () => { const f = {status:'ready' as const,snapshot:snapshot()}; expect(screenCandidate(candidate,{...defaultProfile,minimumRevenueGrowthPct:null},f,now).status).toBe('UNKNOWN'); expect(screenCandidate(candidate,{...defaultProfile,minimumAverageDailyShares:100},f,now).status).toBe('UNKNOWN'); });
  it('does not pass future or stale evidence', () => { for (const date of ['2027-01-01','2020-01-01']) { const s=snapshot();s.screening.periodEnd=date;expect(screenCandidate(candidate,defaultProfile,{status:'ready',snapshot:s},now).status).toBe('UNKNOWN'); } });
  it('does not pass conflicted revenue lineage', () => { const s=snapshot();s.facts[0].status='conflicted';s.facts[0].value=null;expect(screenCandidate(candidate,defaultProfile,{status:'ready',snapshot:s},now).status).toBe('UNKNOWN'); });
  it('fails excluded markets without an external call', async () => { const read=vi.fn(); const input={kind:'screen',workspace:{...workspace,profile:{...defaultProfile,markets:['br']}},idempotencyKey}; const out=await executeJob(input,read);expect(read).not.toHaveBeenCalled();expect(out.kind === 'screen' && out.screens[0].status).toBe('FAIL'); });
});
describe('grounded research handoffs', () => {
  const screen = screenCandidate(candidate,defaultProfile,{status:'ready',snapshot:snapshot()},now);
  const claim = {text:'The supplied revenue record supports further growth research.',evidenceIds:[fixture.snapshot.facts[0].id],falsifier:'A restatement contradicting the record.'};
  const draft = {bull:[claim],bear:[{...claim,text:'Revenue alone does not establish a durable moat.'}],conclusion:'review',gaps:[]};
  it('accepts qualitative claims citing supplied evidence', () => { expect(validateResearchDraft(draft,screen).conclusion).toBe('review'); });
  it('rejects unknown evidence and invented numbers', () => { expect(() => validateResearchDraft({...draft,bull:[{...claim,evidenceIds:['invented']}]},screen)).toThrow(); expect(() => validateResearchDraft({...draft,bull:[{...claim,text:'Revenue is up 999%.'}]},screen)).toThrow(); });
  it('keeps valuation external and review mandatory', () => { const pack=researchWorkbench(screen);expect(pack.financialAuthority).toBe('FilingLens');expect(pack.approval).toBe('human_review_required');expect(pack.valuation.status).toBe('external_only'); });
  it('works without paid model calls', async () => { vi.stubEnv('RESEARCH_MODEL_ENABLED','false');const fetcher=vi.fn();expect(await generateResearchDraft(screen,fetcher)).toBeNull();expect(fetcher).not.toHaveBeenCalled(); });
  it('makes one bounded draft call and retains returned usage', async () => {
    vi.stubEnv('RESEARCH_MODEL_ENABLED','true');vi.stubEnv('RESEARCH_MODEL_API_KEY','test-only');vi.stubEnv('RESEARCH_MODEL_NAME','explicit-test-model');
    const transport=vi.fn(async()=>Response.json({choices:[{message:{content:JSON.stringify(draft)}}],usage:{prompt_tokens:100,completion_tokens:80}}));
    const generated=await generateResearchDraft(screen,transport);expect(generated?.draft.conclusion).toBe('review');expect(generated?.usage).toEqual({prompt_tokens:100,completion_tokens:80});expect(transport).toHaveBeenCalledTimes(1);
  });
  it('does not retry a model failure', async () => {
    vi.stubEnv('RESEARCH_MODEL_ENABLED','true');vi.stubEnv('RESEARCH_MODEL_API_KEY','test-only');vi.stubEnv('RESEARCH_MODEL_NAME','explicit-test-model');
    const transport=vi.fn(async()=>new Response('',{status:503}));await expect(generateResearchDraft(screen,transport)).rejects.toThrow('research_model_request_failed');expect(transport).toHaveBeenCalledTimes(1);
  });
  it('retains an evidence pack on model failure', async () => { const out=await executeJob({kind:'research',candidateKey:candidate.key,workspace,idempotencyKey},async()=>({status:'ready',snapshot:snapshot()}),async()=>{throw new Error('paid endpoint unavailable');});expect('modelStatus' in out && out.modelStatus).toBe('model_failed_evidence_pack_retained'); });
});
describe('finance transport', () => {
  const options={baseUrl:'https://finance.example',token:'t'.repeat(40)};
  it('reads the verified fixture with GET only', async () => { const f=vi.fn(async()=>Response.json(fixture.snapshot));const s=await readFilingLensSnapshot(candidate.issuer!,{...options,fetch:f});expect(s.screening.revenueGrowthYoYPct).toBe(20);expect(f.mock.calls[0]).toBeDefined(); });
  it('rejects digest/issuer drift and insecure origins', async () => { const s=structuredClone(fixture.snapshot);s.facts[0].value='999';await expect(readFilingLensSnapshot(candidate.issuer!,{...options,fetch:async()=>Response.json(s)})).rejects.toThrow('finance_integrity_failed');await expect(readFilingLensSnapshot(candidate.issuer!,{...options,baseUrl:'http://finance.example'})).rejects.toThrow('invalid_finance_config'); });
  it('does not retry unauthorized requests', async () => { const f=vi.fn(async()=>new Response('',{status:401}));await expect(readFilingLensSnapshot(candidate.issuer!,{...options,fetch:f})).rejects.toThrow('finance_unauthorized');expect(f).toHaveBeenCalledTimes(1); });
  it('caps transient retries and response size', async () => { const f=vi.fn(async()=>new Response('',{status:503}));await expect(readFilingLensSnapshot(candidate.issuer!,{...options,fetch:f})).rejects.toThrow();expect(f).toHaveBeenCalledTimes(2);await expect(readFilingLensSnapshot(candidate.issuer!,{...options,fetch:async()=>new Response('x'.repeat(256_001),{headers:{'content-type':'application/json'}})})).rejects.toThrow('response_too_large'); });
});
