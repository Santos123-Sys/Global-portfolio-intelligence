import { searchWeb } from '../../search/web-search';
import type { DiscoveredDocument } from '../types';

function classify(text: string): Pick<DiscoveredDocument, 'documentType' | 'folderType'> {
  if (/fato relevante/i.test(text)) return { documentType: 'FATO_RELEVANTE', folderType: 'MATERIAL_FACT' };
  if (/\bITR\b/i.test(text)) return { documentType: 'ITR', folderType: 'REGULATORY_FILING' };
  if (/\bDFP\b/i.test(text)) return { documentType: 'DFP', folderType: 'REGULATORY_FILING' };
  if (/\bFRE\b/i.test(text)) return { documentType: 'FRE', folderType: 'OTHER_DOCUMENT' };
  return { documentType: 'FINANCIAL_REPORT', folderType: 'FINANCIAL_REPORT' };
}
/** Uses the existing server-only search boundary only to locate original CVM URLs. */
export async function discoverBrFilings(ticker: string): Promise<DiscoveredDocument[]> {
  const search = await searchWeb(`site:gov.br/cvm ${ticker} DFP ITR fato relevante` , 10);
  return search.results.filter((result) => { try { return new URL(result.url).hostname.toLowerCase().endsWith('gov.br'); } catch { return false; } }).map((result) => {
    const kind = classify(`${result.title} ${result.snippet}`);
    return { ...kind, title: result.title, description: result.snippet, url: result.url, source: 'cvm_dfp', externalId: result.url, isPrimarySource: true };
  });
}
