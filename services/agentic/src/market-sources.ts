import { createHash } from 'node:crypto';
import type { MarketBriefRequest } from '@portfolio-intelligence/agentic-contract';

export type RetrievedEvidence = {
  id: string; title: string; publisher: string; url: string;
  sourceKind: 'regulatory_filing' | 'official_statistics' | 'issuer' | 'market_data' | 'research' | 'other';
  publishedAt: string | null; retrievedAt: string; supports?: string[]; excerpt: string;
};

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

function sourceId(url: string) { return `source:${createHash('sha256').update(url).digest('hex').slice(0, 16)}`; }

async function boundedJson(url: string, headers: Record<string, string>, timeoutMs = 12_000): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'error', cache: 'no-store' });
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > 15_000_000) throw new Error('Provider response exceeds 15 MB');
  const text = await response.text();
  if (text.length > 15_000_000) throw new Error('Provider response exceeds 15 MB');
  return JSON.parse(text);
}

function shortJson(value: unknown): string { return JSON.stringify(value).slice(0, 12_000); }

export async function retrieveBrapiIndicators(request: MarketBriefRequest, apiKey?: string): Promise<RetrievedEvidence[]> {
  if (!apiKey || request.security.exchange !== 'BVMF') return [];
  const url = new URL('https://brapi.dev/api/v2/stocks/financial-data');
  url.searchParams.set('symbols', request.security.ticker);
  url.searchParams.set('mode', 'current');
  const data = await boundedJson(url.toString(), { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' });
  const payload = data as { results?: Array<{ symbol?: string; financialData?: unknown }> };
  const matched = payload.results?.find((item) => item.symbol?.toUpperCase() === request.security.ticker.toUpperCase());
  if (!matched?.financialData || !matched.symbol) return [];
  return [{
    id: sourceId(url.toString()), title: `BrAPI financial indicators · ${matched.symbol}`,
    publisher: 'BrAPI (Brazilian market-data API)', url: url.toString(), sourceKind: 'market_data',
    publishedAt: null, retrievedAt: new Date().toISOString(), supports: [],
    excerpt: `Current financial indicator response for ${matched.symbol}: ${shortJson(matched.financialData)}`,
  }];
}

function urlsFromText(text: string): string[] {
  const candidates = [...text.matchAll(/https:\/\/[^\s\])}>"']+/g)].map((match) => match[0].replace(/[.,;:]$/, ''));
  return [...new Set(candidates.flatMap((candidate) => { const url = safeUrl(candidate); return url ? [url] : []; }))].slice(0, 20);
}

export async function retrieveMaritacaBrazilResearch(request: MarketBriefRequest, apiKey?: string, model = 'sabia-4-thinking'): Promise<RetrievedEvidence[]> {
  if (!apiKey || (request.security.exchange !== 'BVMF' && request.security.country?.toUpperCase() !== 'BR')) return [];
  const body = JSON.stringify({
    model,
    input: `Research ${request.security.companyName} (${request.security.ticker}) for an investment-market brief. Use the official Brazilian Data Ocean for relevant Brazilian company and macroeconomic facts. Prefer CVM filings for issuer-reported facts and Banco Central do Brasil/IBGE for macro facts. Return a concise evidence-led research note with source titles, publication dates when available, exact HTTPS source URLs, and a clear distinction between verified facts, estimates, and unknowns. Do not calculate valuation or recommend a portfolio weight. Market scope: ${request.security.sector ?? 'unknown sector'} / ${request.security.industry ?? 'unknown industry'}; thesis constraints: ${request.thesis.globalConstraints.join('; ')}.`,
    tools: [{ type: 'data_ocean' }],
  });
  const result = await fetch('https://chat.maritaca.ai/api/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body, signal: AbortSignal.timeout(90_000), redirect: 'error', cache: 'no-store',
  });
  if (!result.ok) throw new Error(`Maritaca Data Ocean returned HTTP ${result.status}`);
  const data = await result.json() as { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>; output_text?: string };
  const text = data.output_text ?? data.output?.flatMap((item) => item.content ?? []).filter((item) => item.type === 'output_text').map((item) => item.text ?? '').join('\n') ?? '';
  if (!text.trim()) return [];
  const urls = urlsFromText(text);
  return urls.map((url) => {
    const host = new URL(url).hostname.toLowerCase();
    const sourceKind = /(^|\.)cvm\.gov\.br$/.test(host) ? 'regulatory_filing'
      : /(^|\.)bcb\.gov\.br$/.test(host) || /(^|\.)ibge\.gov\.br$/.test(host) ? 'official_statistics' : 'research';
    return {
      id: sourceId(url), title: `Maritaca Data Ocean source · ${host}`, publisher: 'Maritaca Data Ocean', url,
      sourceKind, publishedAt: null, retrievedAt: new Date().toISOString(), supports: [],
      excerpt: citationExcerpt(text, url),
    } as RetrievedEvidence;
  });
}

function citationExcerpt(text: string, url: string): string {
  const at = text.indexOf(url);
  if (at < 0) return text.slice(0, 1_200);
  return text.slice(Math.max(0, at - 700), Math.min(text.length, at + url.length + 300)).trim();
}

export async function retrieveSecIssuerEvidence(request: MarketBriefRequest, userAgent?: string): Promise<RetrievedEvidence[]> {
  const country = (request.security.country ?? '').toUpperCase();
  const isUs = ['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(country)
    || ['NASDAQ', 'NYSE', 'NYSEAMERICAN', 'NYSE ARCA'].includes(request.security.exchange.toUpperCase());
  if (!userAgent || !isUs) return [];
  const ua = userAgent.trim();
  if (ua.length < 12 || !ua.includes('@')) throw new Error('SEC_USER_AGENT must identify an organization and contact email');
  const registryUrl = 'https://www.sec.gov/files/company_tickers_exchange.json';
  const registry = await boundedJson(registryUrl, { 'User-Agent': ua, Accept: 'application/json' });
  const entries = secTickerEntries(registry);
  const matches = entries.filter((entry) => entry.ticker?.toUpperCase() === request.security.ticker.toUpperCase());
  if (matches.length !== 1 || !matches[0].cik) return [];
  const cik = String(matches[0].cik).padStart(10, '0');
  const companyFactsUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  const facts = await boundedJson(companyFactsUrl, { 'User-Agent': ua, Accept: 'application/json' }) as { entityName?: string; facts?: Record<string, Record<string, unknown>> };
  const nameTokens = request.security.companyName.toUpperCase().split(/[^A-Z0-9]+/).filter((part) => part.length > 3);
  if (!facts.entityName || !nameTokens.some((part) => facts.entityName!.toUpperCase().includes(part))) return [];
  const summary = summarizeSecFacts(facts.facts ?? {});
  return [{ id: sourceId(companyFactsUrl), title: `SEC EDGAR company facts · ${facts.entityName}`,
    publisher: 'U.S. Securities and Exchange Commission, EDGAR', url: companyFactsUrl, sourceKind: 'regulatory_filing',
    publishedAt: null, retrievedAt: new Date().toISOString(), supports: [],
    excerpt: `Official SEC XBRL company facts for ${facts.entityName}. Ticker ${request.security.ticker}, CIK ${cik}. Recent reported values by concept (USD, as filed; period and form are included): ${shortJson(summary)}.`,
  }];
}

function secTickerEntries(data: unknown): Array<{ cik?: string | number; name?: string; ticker?: string; exchange?: string }> {
  if (Array.isArray(data)) return data.filter((row): row is { cik?: string | number; name?: string; ticker?: string; exchange?: string } => !!row && typeof row === 'object' && !Array.isArray(row));
  if (!data || typeof data !== 'object') return [];
  const record = data as { fields?: unknown; data?: unknown; [key: string]: unknown };
  if (Array.isArray(record.fields) && Array.isArray(record.data)) {
    const fields = record.fields.map((field) => String(field).toLowerCase());
    return record.data.filter(Array.isArray).map((row) => Object.fromEntries(fields.map((field, index) => [field, row[index]])) as { cik?: string | number; name?: string; ticker?: string; exchange?: string });
  }
  return Object.values(record).filter((row): row is { cik?: string | number; name?: string; ticker?: string; exchange?: string } => !!row && typeof row === 'object' && !Array.isArray(row));
}

function summarizeSecFacts(facts: Record<string, Record<string, unknown>>): Record<string, Array<{ value: number; unit: string; end: string; filed: string; form: string; fy?: number; fp?: string }>> {
  const gaap = facts['us-gaap'] as Record<string, { units?: Record<string, Array<{ val?: unknown; end?: string; filed?: string; form?: string; fy?: number; fp?: string }>> }> | undefined;
  if (!gaap) return {};
  const aliases: Record<string, string[]> = {
    revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'],
    operating_income: ['OperatingIncomeLoss'],
    net_income: ['NetIncomeLoss'],
    operating_cash_flow: ['NetCashProvidedByUsedInOperatingActivities'],
    total_assets: ['Assets'],
    long_term_debt: ['LongTermDebtCurrent', 'LongTermDebtNoncurrent'],
  };
  const out: Record<string, Array<{ value: number; unit: string; end: string; filed: string; form: string; fy?: number; fp?: string }>> = {};
  for (const [label, tags] of Object.entries(aliases)) {
    const tag = tags.find((candidate) => gaap[candidate]);
    const units = tag ? gaap[tag].units : undefined;
    const usd = units?.USD;
    if (!usd) continue;
    const rows = usd.filter((row) => typeof row.val === 'number' && !!row.end && !!row.filed && ['10-K', '20-F', '40-F', '10-Q'].includes(row.form ?? ''))
      .sort((a, b) => `${b.end}:${b.filed}`.localeCompare(`${a.end}:${a.filed}`));
    const uniquePeriods = new Map<string, typeof rows[number]>();
    for (const row of rows) {
      const key = `${row.end}:${row.form}`;
      if (!uniquePeriods.has(key)) uniquePeriods.set(key, row);
    }
    const recent = [...uniquePeriods.values()].slice(0, 8).map((row) => ({ value: row.val as number, unit: 'USD', end: row.end!, filed: row.filed!, form: row.form!, fy: row.fy, fp: row.fp }));
    if (recent.length) out[label] = recent;
  }
  return out;
}

export function evidenceIdForUrl(url: string) { return sourceId(url); }
