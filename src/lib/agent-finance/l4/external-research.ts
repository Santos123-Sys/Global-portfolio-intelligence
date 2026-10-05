import type { AnalyzeRequest } from '../contracts';
import { inferResearchMarket, type SupportedResearchMarket } from '../research-policy';
import { runScheduled } from '../l3/task-scheduler';
import type { Foundation } from './foundation';

export type ExternalResearchCategory = 'issuer' | 'industry' | 'risk' | 'catalyst';

export interface ExternalResearchEvidence {
  title: string;
  url: string;
  snippet: string;
  provider: 'tavily-search' | 'brave-search';
  query: string;
  category: ExternalResearchCategory;
  retrievedAt: string;
  publishedAt: string | null;
}

interface ResearchQuery {
  category: ExternalResearchCategory;
  query: string;
}

interface SearchRuntime {
  provider: 'tavily' | 'brave' | 'none';
  apiKey: string;
}

interface SearchRow {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  description?: unknown;
  published_date?: unknown;
  publishedAt?: unknown;
}

function searchRuntime(): SearchRuntime {
  const raw = process.env.WEB_SEARCH_PROVIDER?.trim().toLowerCase();
  const provider = raw === 'tavily' || raw === 'brave' ? raw : 'none';
  return { provider, apiKey: process.env.WEB_SEARCH_API_KEY?.trim() ?? '' };
}

function currentYear(): number {
  return new Date().getUTCFullYear();
}

function marketLabel(market: SupportedResearchMarket): string {
  return { BR: 'Brazil B3', US: 'United States', CH: 'Switzerland SIX', EU: 'European Union', OTHER: 'global' }[market];
}

export function externalResearchQueryPlan(foundation: Foundation, analysisType: AnalyzeRequest['analysisType']): ResearchQuery[] {
  if (analysisType === 'dcf') return [];
  const company = foundation.company.companyName;
  const ticker = foundation.company.ticker;
  const market = inferResearchMarket(foundation.company);
  const sector = foundation.company.sector ?? foundation.company.industry ?? 'industry';
  const identity = `"${company}" ${ticker}`;
  const queries: ResearchQuery[] = [
    { category: 'issuer', query: `${identity} investor relations earnings results guidance ${currentYear()} ${marketLabel(market)}` },
    { category: 'catalyst', query: `${identity} latest news guidance acquisition product catalyst ${currentYear()}` },
    { category: 'industry', query: `${identity} ${sector} competitors market share pricing demand ${marketLabel(market)}` },
    { category: 'risk', query: `${identity} regulatory litigation operational risk competition supply chain ${currentYear()}` },
  ];
  if (analysisType === 'quick') return queries.slice(0, 2);
  if (analysisType === 'fundamental') return queries.slice(0, 3);
  return queries;
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function publishedAt(row: SearchRow): string | null {
  const candidate = typeof row.published_date === 'string' ? row.published_date : typeof row.publishedAt === 'string' ? row.publishedAt : null;
  if (!candidate) return null;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function languageFor(foundation: Foundation): string {
  if (foundation.researchLocale === 'pt-BR') return 'pt';
  if (foundation.researchLocale === 'de') return 'de';
  if (foundation.researchLocale === 'es') return 'es';
  return 'en';
}

function countryFor(market: SupportedResearchMarket): string | null {
  if (market === 'BR') return 'BR';
  if (market === 'US') return 'US';
  if (market === 'CH') return 'CH';
  return null;
}

async function executeSearch(query: ResearchQuery, foundation: Foundation, runtime: SearchRuntime): Promise<ExternalResearchEvidence[]> {
  const retrievedAt = new Date().toISOString();
  if (runtime.provider === 'tavily') {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${runtime.apiKey}` },
      body: JSON.stringify({ query: query.query, max_results: 5, search_depth: 'basic', include_answer: false, include_raw_content: false }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Tavily evidence search failed (${response.status})`);
    const body = await response.json() as { results?: SearchRow[] };
    return (Array.isArray(body.results) ? body.results : []).flatMap(row => {
      const url = safeUrl(row.url);
      const snippet = typeof row.content === 'string' ? row.content.trim() : '';
      if (!url || !snippet) return [];
      return [{ title: typeof row.title === 'string' ? row.title.trim() : url, url, snippet: snippet.slice(0, 3000), provider: 'tavily-search' as const, query: query.query, category: query.category, retrievedAt, publishedAt: publishedAt(row) }];
    });
  }

  const market = inferResearchMarket(foundation.company);
  const endpoint = new URL('https://api.search.brave.com/res/v1/web/search');
  endpoint.searchParams.set('q', query.query);
  endpoint.searchParams.set('count', '5');
  endpoint.searchParams.set('search_lang', languageFor(foundation));
  const country = countryFor(market);
  if (country) endpoint.searchParams.set('country', country);
  endpoint.searchParams.set('safesearch', 'moderate');
  const response = await fetch(endpoint, {
    headers: { accept: 'application/json', 'x-subscription-token': runtime.apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Brave evidence search failed (${response.status})`);
  const body = await response.json() as { web?: { results?: SearchRow[] } };
  return (Array.isArray(body.web?.results) ? body.web!.results! : []).flatMap(row => {
    const url = safeUrl(row.url);
    const snippet = typeof row.description === 'string' ? row.description.trim() : '';
    if (!url || !snippet) return [];
    return [{ title: typeof row.title === 'string' ? row.title.trim() : url, url, snippet: snippet.slice(0, 3000), provider: 'brave-search' as const, query: query.query, category: query.category, retrievedAt, publishedAt: publishedAt(row) }];
  });
}

/**
 * Bounded external acquisition owned by the Research Director. Specialists do
 * not browse independently: new web evidence enters the immutable session
 * snapshot first, so downstream citations and verification share one source set.
 */
export async function acquireExternalResearch(foundation: Foundation, analysisType: AnalyzeRequest['analysisType']): Promise<{ evidence: ExternalResearchEvidence[]; gaps: string[] }> {
  const runtime = searchRuntime();
  const plan = externalResearchQueryPlan(foundation, analysisType);
  if (!plan.length || runtime.provider === 'none') return { evidence: [], gaps: [] };
  if (!runtime.apiKey) return { evidence: [], gaps: [`${runtime.provider} search is configured but WEB_SEARCH_API_KEY is missing.`] };

  const settled = await runScheduled(plan.map(query => () => executeSearch(query, foundation, runtime)), { concurrency: 2 });
  const gaps: string[] = [];
  const deduped = new Map<string, ExternalResearchEvidence>();
  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      gaps.push(`External ${plan[index].category} research was unavailable: ${result.reason instanceof Error ? result.reason.message : 'provider error'}.`);
      return;
    }
    for (const item of result.value) if (!deduped.has(item.url)) deduped.set(item.url, item);
  });
  return { evidence: [...deduped.values()].slice(0, 16), gaps };
}
