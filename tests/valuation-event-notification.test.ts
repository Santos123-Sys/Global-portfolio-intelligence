import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST, signature, validSignature } from '../src/app/api/integration/v1/valuation-events/route';

const secret = 's'.repeat(48);
afterEach(() => vi.unstubAllEnvs());
function makeRequest(body: string, auth?: string) {
  return new Request('https://gpi.example.test/api/integration/v1/valuation-events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { 'x-filinglens-signature': auth } : {}) },
    body,
  });
}
describe('FilingLens reviewed valuation notification boundary', () => {
  it('checks exact event bytes with domain-separated HMAC', () => {
    const raw = '{"schemaVersion":"filinglens-valuation-approved.v1"}';
    const sig = 'sha256=' + signature(raw, secret);
    expect(validSignature(raw, sig, secret)).toBe(true);
    expect(validSignature(raw + ' ', sig, secret)).toBe(false);
    expect(validSignature(raw, 'sha256=' + '0'.repeat(64), secret)).toBe(false);
    expect(validSignature(raw, sig, 'short')).toBe(false);
  });
  it('rejects anonymous, forged and invalid events without attempting database access', async () => {
    vi.stubEnv('INTEGRATION_SIGNING_SECRET', secret);
    vi.stubEnv('FILINGLENS_VALUATION_READ_ENABLED', 'true');
    const event = JSON.stringify({ schemaVersion: 'filinglens-valuation-approved.v1',
      ticket: 'not-a-real-handoff', valuationVersionId: 'flv1_' + 'a'.repeat(64),
      issuedAt: new Date().toISOString() });
    expect((await POST(makeRequest(event))).status).toBe(401);
    expect((await POST(makeRequest(event, 'sha256=' + 'f'.repeat(64)))).status).toBe(401);
    expect((await POST(makeRequest('{}', 'sha256=' + signature('{}', secret)))).status).toBe(422);
  });
  it('rejects an expired notification before parsing the handoff ticket', async () => {
    vi.stubEnv('INTEGRATION_SIGNING_SECRET', secret);
    vi.stubEnv('FILINGLENS_VALUATION_READ_ENABLED', 'true');
    const body = JSON.stringify({ schemaVersion: 'filinglens-valuation-approved.v1',
      ticket: 'invalid-but-unused', valuationVersionId: 'flv1_' + 'b'.repeat(64),
      issuedAt: '2020-01-01T12:00:00.000Z' });
    expect((await POST(makeRequest(body, 'sha256=' + signature(body, secret)))).status).toBe(410);
  });
  it('fails closed when the integration is not configured', async () => {
    vi.stubEnv('INTEGRATION_SIGNING_SECRET', secret);
    vi.stubEnv('FILINGLENS_VALUATION_READ_ENABLED', 'false');
    expect((await POST(makeRequest('{}'))).status).toBe(503);
  });
});
