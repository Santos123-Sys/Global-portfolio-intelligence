import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireExternalResearch, externalResearchQueryPlan } from '../src/lib/agent-finance/l4/external-research';
import type { Foundation } from '../src/lib/agent-finance/l4/foundation';

function foundation(overrides: Partial<Foundation['company']> = {}, locale: Foundation['researchLocale'] = 'en'): Foundation {
  return {
    company: {
      id: 'security-1', ticker: 'NESN', companyName: 'Nestle SA', exchange: 'XSWX', currency: 'CHF', sector: 'Consumer Staples', industry: 'Food', country: 'CH', isin: null,
      ...overrides,
    },
    researchLocale: locale,
  } as unknown as Foundation;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Research Director external evidence acquisition', () => {
  it('creates a bounded market-aware query plan', () => {
    const quick = externalResearchQueryPlan(foundation({ ticker: 'PETR4', companyName: 'Petrobras', exchange: 'BVMF', currency: 'BRL', country: 'BR', sector: 'Energy' }, 'pt-BR'), 'quick');
    expect(quick).toHaveLength(2);
    expect(quick[0].query).toContain('Brazil B3');
    expect(quick[0].query).toContain('Petrobras');
    expect(externalResearchQueryPlan(foundation(), 'combined')).toHaveLength(4);
    expect(externalResearchQueryPlan(foundation(), 'dcf')).toHaveLength(0);
  });

  it('does not turn an unconfigured web provider into a research failure', async () => {
    vi.stubEnv('WEB_SEARCH_PROVIDER', 'none');
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const result = await acquireExternalResearch(foundation(), 'combined');
    expect(result).toEqual({ evidence: [], gaps: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the security market instead of a hard-coded US Brave locale and deduplicates sources', async () => {
    vi.stubEnv('WEB_SEARCH_PROVIDER', 'brave');
    vi.stubEnv('WEB_SEARCH_API_KEY', 'test-key');
    vi.stubEnv('AGENT_STAGGER_MS', '0');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      web: { results: [{ title: 'Issuer update', url: 'https://example.com/research', description: 'Evidence snippet for the issuer.' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await acquireExternalResearch(foundation(), 'combined');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [input] of fetchMock.mock.calls) {
      const url = new URL(String(input));
      expect(url.searchParams.get('country')).toBe('CH');
      expect(url.searchParams.get('search_lang')).toBe('en');
    }
    expect(result.gaps).toEqual([]);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ url: 'https://example.com/research', provider: 'brave-search' });
  });
});
