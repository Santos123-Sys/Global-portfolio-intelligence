import type { DiscoveredDocument } from '../types';

const ORIGIN = 'https://data.sec.gov';
let tickerRegistry: Record<string, { cik_str: number; ticker: string; title: string }> | null = null;

function userAgent() { const value = process.env.SEC_USER_AGENT?.trim(); if (!value || !value.includes('@')) throw new Error('SEC_USER_AGENT must contain an application name and contact email'); return value; }
async function secJson(url: string) { const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': userAgent() }, signal: AbortSignal.timeout(20_000), cache: 'no-store' }); if (!response.ok) throw new Error(`SEC EDGAR request failed (${response.status})`); return response.json(); }

function folder(form: string): DiscoveredDocument['folderType'] { return ['8-K', '6-K'].includes(form.replace('/A', '')) ? 'MATERIAL_FACT' : ['10-K', '10-Q', '20-F', '6-K'].includes(form.replace('/A', '')) ? 'REGULATORY_FILING' : form.startsWith('DEF') ? 'OTHER_DOCUMENT' : 'REGULATORY_FILING'; }

export async function discoverUsFilings(ticker: string): Promise<DiscoveredDocument[]> {
  tickerRegistry ??= await secJson('https://www.sec.gov/files/company_tickers.json') as typeof tickerRegistry;
  const issuer = Object.values(tickerRegistry ?? {}).find((entry) => entry.ticker.toUpperCase() === ticker.toUpperCase());
  if (!issuer) return [];
  const cik = String(issuer.cik_str).padStart(10, '0');
  const submission = await secJson(`${ORIGIN}/submissions/CIK${cik}.json`) as { filings?: { recent?: Record<string, unknown[]> } };
  const recent = submission.filings?.recent ?? {};
  const forms = Array.isArray(recent.form) ? recent.form : [];
  const accessions = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : [];
  const dates = Array.isArray(recent.filingDate) ? recent.filingDate : [];
  const periods = Array.isArray(recent.reportDate) ? recent.reportDate : [];
  const primary = Array.isArray(recent.primaryDocument) ? recent.primaryDocument : [];
  const accepted = new Set(['10-K', '10-K/A', '10-Q', '10-Q/A', '8-K', '8-K/A', '20-F', '20-F/A', '6-K', 'DEF 14A']);
  return forms.flatMap((raw, index) => {
    const form = String(raw); const accession = String(accessions[index] ?? ''); const document = String(primary[index] ?? '');
    if (!accepted.has(form) || !accession || !document) return [];
    const compact = accession.replaceAll('-', '');
    return [{ documentType: form, externalId: accession, title: `${ticker} ${form} - ${dates[index]}`, publishedDate: String(dates[index] ?? ''), fiscalYearEnd: String(periods[index] ?? '') || undefined, fiscalPeriod: /10-Q/.test(form) ? 'quarterly' : /10-K|20-F/.test(form) ? 'annual' : undefined, url: `https://www.sec.gov/Archives/edgar/data/${issuer.cik_str}/${compact}/${encodeURIComponent(document)}`, source: 'sec_edgar', isPrimarySource: true, folderType: folder(form), isAmendment: form.endsWith('/A') } satisfies DiscoveredDocument];
  });
}
