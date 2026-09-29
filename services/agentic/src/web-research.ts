import type { SecurityUniverseRecord } from '@portfolio-intelligence/agentic-contract';
import { verifyPrimarySources } from './primary-source.js';
export interface WebResearchConfig {
  provider: 'none' | 'brave' | 'tavily';
  apiKey?: string;
}

export interface WebResearchEvidence {
  query: string;
  urls: string[];
  snippets: string[];
  gaps?: string[];
  sources?: Array<{ url: string; snippet: string; retrievedAt: string; publishedAt: string | null;
    tier?: 'primary' | 'unclassified'; kind?: 'primary_document' | 'search_result'; contentHash?: string; verification?: 'issuer_identity_matched'; }>;

}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

/** A bounded wait and two spaced retries for transient search-provider failures. */
async function searchResponse(url: string | URL, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) });
      if (response.ok) return response;
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`Research provider rejected the request (${response.status})`);
      }
      if (attempt === 2) throw new Error(`Research provider unavailable after retries (${response.status})`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Research provider rejected')) throw error;
      if (attempt === 2) throw new Error('Research provider timed out or could not be reached after retries');
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw new Error('Research provider unavailable');
}

function searchEvidence(query: string, rows: unknown[], snippetField: string): WebResearchEvidence {
  const retrievedAt = new Date().toISOString();
  const sources = rows.map(record).flatMap(row => {
    const url = text(row.url);
    try { if (!['https:', 'http:'].includes(new URL(url).protocol)) return []; } catch { return []; }
    return [{ url, snippet: text(row[snippetField]), retrievedAt, publishedAt: text(row.published_date) || null }];
  });
  return { query, urls: sources.map(s => s.url), snippets: sources.map(s => s.snippet).filter(Boolean), sources };
}

/** Server-side qualitative evidence only: never a substitute for market data. */
export async function researchCompany(companyName: string, ticker: string, config: WebResearchConfig): Promise<WebResearchEvidence> {
  const query = `${companyName} ${ticker} business activities products services customers market size TAM demand value chain distribution channels competitors market share sector economics strategy catalysts regulatory and policy drivers risks`;
  if (config.provider === 'none' || !config.apiKey) return { query, urls: [], snippets: [] };
  if (config.provider === 'tavily') {
    const response = await searchResponse('https://api.tavily.com/search', {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ query, max_results: 3, search_depth: 'basic', include_answer: false, include_raw_content: false }),
    });
    const raw = record(await response.json());
    const rows: unknown[] = Array.isArray(raw.results) ? raw.results : [];
    return searchEvidence(query, rows, 'content');
  }
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query); url.searchParams.set('count', '3');
  const response = await searchResponse(url, { headers: { accept: 'application/json', 'x-subscription-token': config.apiKey } });
  const raw = record(await response.json());
  const searchResults = record(raw.web).results;
  const rows: unknown[] = Array.isArray(searchResults) ? searchResults : [];
  return searchEvidence(query, rows, 'description');
}


/** Trusted issuer/filing retrieval precedes general search. */
export async function researchSecurity(security: SecurityUniverseRecord, config: WebResearchConfig): Promise<WebResearchEvidence> {
  const primary = await verifyPrimarySources(security);
  if (primary.sources.length) return { query: 'Direct issuer/filing source retrieval', urls: primary.sources.map(s => s.url), snippets: primary.sources.map(s => s.snippet), sources: primary.sources, gaps: primary.gaps };
  const secondary = await researchCompany(security.companyName, security.ticker, config);
  return { ...secondary, gaps: [...primary.gaps, 'Secondary search evidence is not verified primary evidence.'] };
}
