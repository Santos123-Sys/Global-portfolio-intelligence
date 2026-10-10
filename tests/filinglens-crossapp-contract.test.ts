import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { readFilingLensSnapshot, FilingLensReadError } from '@/lib/integrations/filinglens-client';
import { FilingLensSnapshot } from '@/lib/integrations/filinglens-contract';

const token = 't'.repeat(48);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function syntheticFinance(jurisdiction: 'us' | 'br') {
  const issuer = { jurisdiction, registryId: jurisdiction === 'us' ? '0000320193' : '12345678000195' };
  const provider = jurisdiction === 'us' ? 'sec_edgar' : 'cvm_open_data';
  const url = jurisdiction === 'us' ? 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json'
    : 'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp.csv';
  const fact = {
    id: hash('synthetic-fact'), metric: 'revenue', value: '120', unit: jurisdiction === 'us' ? 'USD millions' : 'BRL millions',
    currency: jurisdiction === 'us' ? 'USD' : 'BRL', fiscalYear: 2025, periodKind: 'FY' as const,
    periodEnd: '2025-12-31', periodLabel: 'FY 2025', status: 'single_source' as const,
    sources: [{ url, provider, form: jurisdiction === 'us' ? '10-K' : 'DFP', retrievedAt: '2026-10-10' }],
  };
  const archiveHash = hash('synthetic-regulatory-archive');
  const payload = {
    schemaVersion: 'filinglens-public-finance-v1' as const,
    snapshotId: 'flpub1_' + archiveHash, archiveHash, archivedOn: '2026-10-10',
    visibility: 'public_regulatory' as const, issuer, provider, facts: [fact],
    screening: { revenueGrowthYoYPct: null, basis: 'annual_same_currency_unit' as const,
      inputFactIds: [], periodEnd: null, calculatorVersion: 'revenue-yoy-v1' as const },
    limitations: ['Synthetic contract fixture, not live regulatory data.'],
  };
  return FilingLensSnapshot.parse({ ...payload, contentHash: hash(JSON.stringify(payload)) });
}

function fetchSnapshot(value: unknown) {
  return vi.fn(async (_input: Request | string | URL, _init?: RequestInit) => new Response(JSON.stringify(value), {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
}

describe('FilingLens v1 consumer contract', () => {
  it.each(['us', 'br'] as const)('accepts source-linked %s issuer snapshots without modifying published numbers', async jurisdiction => {
    const snapshot = syntheticFinance(jurisdiction);
    const mockFetch = fetchSnapshot(snapshot);
    const actual = await readFilingLensSnapshot(snapshot.issuer, { baseUrl: 'https://filinglens.example/', token, fetch: mockFetch });
    expect(actual.facts[0].value).toBe('120');
    expect(actual.facts[0].unit).toBe(snapshot.facts[0].unit);
    expect(actual.contentHash).toBe(snapshot.contentHash);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/api/integration/v1/issuers/' + jurisdiction + '/' + snapshot.issuer.registryId);
    expect(options?.method).toBe('GET');
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer ' + token });
    expect(options?.redirect).toBe('error');
  });

  it('rejects altered numerical content even when the payload remains structurally valid', async () => {
    const snapshot = syntheticFinance('us');
    const forged = { ...snapshot, facts: [{ ...snapshot.facts[0], value: '121' }] };
    await expect(readFilingLensSnapshot(snapshot.issuer, {
      baseUrl: 'https://filinglens.example/', token, fetch: fetchSnapshot(forged),
    })).rejects.toMatchObject({ code: 'finance_integrity_failed' } satisfies Partial<FilingLensReadError>);
  });

  it('rejects a response for a different registry identity', async () => {
    const snapshot = syntheticFinance('br');
    await expect(readFilingLensSnapshot({ jurisdiction: 'us', registryId: '0000320193' }, {
      baseUrl: 'https://filinglens.example/', token, fetch: fetchSnapshot(snapshot),
    })).rejects.toMatchObject({ code: 'finance_identity_mismatch' });
  });

  it('never sends its bearer token to an insecure endpoint', async () => {
    const mockFetch = fetchSnapshot(syntheticFinance('us'));
    await expect(readFilingLensSnapshot({ jurisdiction: 'us', registryId: '0000320193' }, {
      baseUrl: 'http://filinglens.example/', token, fetch: mockFetch,
    })).rejects.toMatchObject({ code: 'invalid_finance_config' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('treats a missing archive as missing rather than an accepted zero', async () => {
    const mockFetch = vi.fn(async () => new Response('{"error":"snapshot_not_found"}', { status: 404 }));
    await expect(readFilingLensSnapshot({ jurisdiction: 'us', registryId: '0000320193' }, {
      baseUrl: 'https://filinglens.example/', token, fetch: mockFetch,
    })).rejects.toMatchObject({ code: 'snapshot_not_found' });
  });
});
