import { z } from 'zod';
import { ValueScorecardPolicy } from '@portfolio-intelligence/agentic-contract';

export const supportedResearchMarketSchema = z.enum(['BR', 'US', 'CH', 'EU', 'OTHER']);
export type SupportedResearchMarket = z.infer<typeof supportedResearchMarketSchema>;
export function resolveResearchProfile(company:Parameters<typeof inferResearchMarket>[0],request?:{market?:SupportedResearchMarket;locale?:'pt-BR'|'en'|'de'|'es'},thesisLocale?:'pt-BR'|'en'|'de'|'es') {
  const market=inferResearchMarket(company);
  if(request?.market && request.market!==market) throw new Error('Requested research market conflicts with the retained security metadata');
  return {market,locale:request?.locale ?? thesisLocale ?? (market==='BR'?'pt-BR':'en')};
}

export const researchProviderPolicy = {
  BR: { securityMaster: ['brapi'], filings: ['maritaca', 'cvm'], fundamentals: ['maritaca', 'brapi'], macro: ['maritaca'], news: ['news_adapter'] },
  US: { securityMaster: ['sec_edgar'], filings: ['sec_edgar'], fundamentals: ['sec_edgar'], macro: [], news: ['news_adapter'] },
  CH: { securityMaster: ['six', 'eodhd'], filings: ['issuer_relations'], fundamentals: ['issuer_relations'], macro: [], news: ['news_adapter'] },
  EU: { securityMaster: ['eodhd'], filings: ['issuer_relations'], fundamentals: ['issuer_relations'], macro: [], news: ['news_adapter'] },
  OTHER: { securityMaster: ['eodhd'], filings: ['issuer_relations'], fundamentals: ['issuer_relations'], macro: [], news: ['news_adapter'] },
} as const;

export function inferResearchMarket(input: { country?: string | null; exchange?: string | null; currency?: string | null }): SupportedResearchMarket {
  const country = input.country?.toUpperCase(); const exchange = input.exchange?.toUpperCase();
  if (country === 'BR' || ['B3','BVMF','SA'].includes(exchange ?? '')) return 'BR';
  if (country === 'US' || ['NYSE', 'NASDAQ', 'AMEX'].includes(exchange ?? '')) return 'US';
  if (country === 'CH' || ['SIX','XSWX','SW'].includes(exchange ?? '')) return 'CH';
  if (country && ['AT','BE','DE','ES','FI','FR','IE','IT','LU','NL','PT'].includes(country)) return 'EU';
  return 'OTHER';
}

export const marketResearchModules = [
  'market_size_cross_validation', 'tam_sam_som', 'volume_price_mix', 'market_lifecycle',
  'competitive_concentration', 'channel_economics', 'customer_and_supplier_concentration',
] as const;

export const valueScorecardPolicySchema = ValueScorecardPolicy;

export const sectorFinancialPolicies: Record<string, { disabledRules: string[]; notes: string[] }> = {
  financials: { disabledRules: ['current_ratio', 'inventory_growth', 'total_liabilities_ratio'], notes: ['Use regulatory capital, asset quality, liquidity and funding metrics for banks and insurers.'] },
  real_estate: { disabledRules: ['current_ratio'], notes: ['Review debt maturities, secured leverage, occupancy and recurring property cash flow.'] },
  utilities: { disabledRules: [], notes: ['Interpret leverage against regulated cash flows, concession duration and capital expenditure commitments.'] },
  technology: { disabledRules: [], notes: ['Separate stock compensation and capitalized development costs; interpret working capital using the revenue model.'] },
  default: { disabledRules: [], notes: [] },
};

export function sectorPolicy(sector?: string | null) {
  const normalized = sector?.toLowerCase().replace(/[^a-z]+/g, '_') ?? 'default';
  if (/bank|insurance|financial/.test(normalized)) return sectorFinancialPolicies.financials;
  if (/real_estate|reit/.test(normalized)) return sectorFinancialPolicies.real_estate;
  if (/utilit/.test(normalized)) return sectorFinancialPolicies.utilities;
  if (/tech|software/.test(normalized)) return sectorFinancialPolicies.technology;
  return sectorFinancialPolicies.default;
}
