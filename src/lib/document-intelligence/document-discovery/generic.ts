import { searchWeb } from '../../search/web-search';
import type { DiscoveredDocument } from '../types';

export async function discoverGenericFilings(ticker: string, exchange: string): Promise<DiscoveredDocument[]> {
  const search = await searchWeb(`${ticker} ${exchange} investor relations annual report interim report ad hoc official`, 10);
  return search.results.filter((result) => /annual report|interim report|financial report|investor presentation|ad hoc|press release/i.test(`${result.title} ${result.snippet}`)).map((result) => {
    const material = /ad hoc|press release|material/i.test(`${result.title} ${result.snippet}`);
    return { documentType: material ? 'PRESS_RELEASE' : /interim/i.test(result.title) ? 'INTERIM_REPORT' : 'ANNUAL_REPORT', folderType: material ? 'MATERIAL_FACT' : 'FINANCIAL_REPORT', source: 'company_ir', title: result.title, description: result.snippet, url: result.url, externalId: result.url, isPrimarySource: /investor|official|annual report/i.test(`${result.title} ${result.snippet}`) };
  });
}
