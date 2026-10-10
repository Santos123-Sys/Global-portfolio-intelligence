import { describe, expect, it } from 'vitest';
import { Candidate } from '../src/lib/foundation/contracts';
import { resolveIssuer, IssuerIdentityV1, IntegrationEventV1,
  ValuationVersionV1, PortfolioExposureV1, RiskRunV1 } from '../src/lib/integrations/shared-contracts';

const candidate = Candidate.parse({ key: 'XNAS:TEST', name: 'Synthetic SEC company',
  ticker: 'TEST', exchange: 'XNAS', market: 'us',
  issuer: { jurisdiction: 'us', registryId: '0000000001' },
  identitySourceUrl: 'https://data.sec.gov/submissions/CIK0000000001.json' });
describe('GPI integration M1 canonical contracts', () => {
  it('resolves only SEC/CVM canonical identities, never ticker guesses', () => {
    const resolved = resolveIssuer(candidate);
    expect(resolved.status).toBe('source_linked');
    if (resolved.status === 'source_linked') expect(resolved.issuer.issuerId).toBe('us:0000000001');
    expect(resolveIssuer({ ...candidate, issuer: null }).status).toBe('unmapped');
    expect(resolveIssuer({ ...candidate, identitySourceUrl: 'https://sec.gov.evil.example/fake' }).status).toBe('unmapped');
  });
  it('never interprets Swiss identifiers as valid', () => {
    expect(IssuerIdentityV1.safeParse({ schemaVersion: 'issuer.v1', issuerId: 'ch:1' }).success).toBe(false);
  });
  it('only accepts externally approved valuation versions', () => {
    const v = { schemaVersion:'valuation.v1', valuationVersionId:'val-1', issuerId:'us:0000000001',
      method:'dcf',scenario:'base',currency:'USD',impliedValuePerShare:'120.20',
      valuationAsOf:'2026-10-10T00:00:00Z',approvedAt:'2026-10-10T01:00:00Z',
      approvedBy:'FilingLens analyst',sourceSnapshotIds:['source-1'],assumptionsHash:'a'.repeat(64),
      approvalStatus:'approved' };
    expect(ValuationVersionV1.safeParse(v).success).toBe(true);
    expect(ValuationVersionV1.safeParse({ ...v, approvalStatus:'draft' }).success).toBe(false);
  });
  it('requires risk provenance and workspace scope', () => {
    const p = { schemaVersion:'portfolio-exposure.v1',portfolioId:'550e8400-e29b-41d4-a716-446655440000',
      workspaceId:'550e8400-e29b-41d4-a716-446655440001',snapshotId:'external-1',
      baseCurrency:'BRL',asOf:'2026-10-10T00:00:00Z',source:'portfolio-risk-studio',
      status:'ready',holdingsCount:3,sectorWeights:{Technology:'0.5'},countryWeights:{US:'0.5'},
      methodologyVersion:'external-v1' };
    expect(PortfolioExposureV1.safeParse(p).success).toBe(true);
    expect(PortfolioExposureV1.safeParse({ ...p, source:'gpi' }).success).toBe(false);
    const risk = { schemaVersion:'portfolio-risk.v1',runId:'550e8400-e29b-41d4-a716-446655440002',
      portfolioId:p.portfolioId,workspaceId:p.workspaceId,asOf:p.asOf,snapshotId:'risk-snapshot',
      status:'partial',priceSource:'provider',fxSource:null,baseCurrency:'USD',methodVersion:'v1',
      warnings:['FX unavailable'],resultReference:null };
    expect(RiskRunV1.safeParse(risk).success).toBe(true);
    expect(RiskRunV1.safeParse({ ...risk, workspaceId:'other-tenant' }).success).toBe(false);
  });
  it('outbox envelope has immutable typed event identity', () => {
    const event = {schemaVersion:'integration-event.v1',eventId:'550e8400-e29b-41d4-a716-446655440002',
      workspaceId:'550e8400-e29b-41d4-a716-446655440001',eventType:'candidate.reviewed.v1',
      source:'gpi',occurredAt:'2026-10-10T00:00:00Z',objectId:'review-1',
      objectVersion:1,correlationId:'550e8400-e29b-41d4-a716-446655440003',payloadHash:'f'.repeat(64)};
    expect(IntegrationEventV1.safeParse(event).success).toBe(true);
    expect(IntegrationEventV1.safeParse({...event,eventType:'trade.executed.v1'}).success).toBe(false);
  });
});
