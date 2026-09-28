import { describe, expect, it, vi } from 'vitest';
import { matchesIssuer, primaryText, publicSourceAddress, publicSourceUrl, verifyPrimarySources } from '../src/primary-source.js';
import type { SecurityUniverseRecord } from '@portfolio-intelligence/agentic-contract';
const security: SecurityUniverseRecord = { ticker: 'ACME', exchange: 'XSWX', companyName: 'Acme Holdings AG', currency: 'CHF', country: 'CH', sector: null, industry: null, assetType: 'Common Stock', observedAt: '2026-09-27T00:00:00Z', provider: 'fixture', sourceUrl: 'https://example.test/list', attributes: { investor_relations_url: 'https://issuer.example/investors' } };
const body = `<html><meta property="article:published_time" content="2026-08-10"><body><h1>Acme Holdings AG annual results</h1>${'Revenue, business operations and principal risks are discussed in this issuer publication. '.repeat(8)}</body></html>`;
describe('primary source provenance verification', () => {
  it('requires actual issuer-matched content and retains digest and document date', async () => {
    const retrieve = vi.fn().mockResolvedValue({ url: 'https://issuer.example/investors', body, hash: 'a'.repeat(64) });
    const result = await verifyPrimarySources(security, retrieve);
    expect(result.sources[0]).toMatchObject({ tier: 'primary', verification: 'issuer_identity_matched', contentHash: 'a'.repeat(64), publishedAt: '2026-08-10' });
    expect(result.sources[0].snippet).toContain('Acme Holdings AG');
    expect(retrieve).toHaveBeenCalledTimes(1);
  });
  it('does not verify a different issuer, a login shell or a hostile cross-host redirect', async () => {
    for (const payload of [{ url: 'https://issuer.example/investors', body: body.replaceAll('Acme Holdings AG', 'Different Entity'), hash: 'a'.repeat(64) }, { url: 'https://issuer.example/investors', body: 'Please sign in', hash: 'a'.repeat(64) }, { url: 'https://other.example/investors', body, hash: 'a'.repeat(64) }]) {
      const result = await verifyPrimarySources(security, async () => payload);
      expect(result.sources).toHaveLength(0); expect(result.gaps.length).toBeGreaterThan(0);
    }
  });
  it('preserves unknown publication dates and ignores script-injected issuer text', async () => {
    const result = await verifyPrimarySources(security, async () => ({ url: 'https://issuer.example/investors', body: body.replace(/<meta[^>]+>/, ''), hash: 'a'.repeat(64) }));
    expect(result.sources[0].publishedAt).toBeNull();
    expect(matchesIssuer(primaryText('<script>Acme Holdings AG</script><p>Another issuer</p>'), security)).toBe(false);
  });
  it('rejects unsafe schemes, credentials, IP URLs, private and reserved addresses', () => {
    for (const url of ['http://issuer.example', 'https://127.0.0.1', 'https://[::1]', 'https://user:pass@issuer.example', 'https://issuer.example:8443', 'https://localhost']) expect(() => publicSourceUrl(url)).toThrow();
    for (const address of ['127.0.0.1', '10.1.1.1', '169.254.169.254', '172.16.1.1', '192.168.1.1', '100.64.0.1', '::1', '192.0.2.1']) expect(publicSourceAddress(address)).toBe(false);
    expect(publicSourceAddress('93.184.216.34')).toBe(true);
  });
  it('records absent trusted sources without treating search evidence as primary', async () => {
    const retrieve = vi.fn(); const result = await verifyPrimarySources({ ...security, attributes: {} }, retrieve);
    expect(result.sources).toEqual([]); expect(result.gaps.join(' ')).toContain('No trusted'); expect(retrieve).not.toHaveBeenCalled();
  });
});
