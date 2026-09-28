import { z } from 'zod';

const country = z.string().regex(/^[A-Z]{2}$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
export const MarketContext = z.object({
  incorporationCountry: country.nullable(), listingExchanges: z.array(z.string().min(1)).min(1),
  reportingCurrency: currency.nullable(), accountingStandard: z.enum(['IFRS', 'US_GAAP', 'SWISS_GAAP_FER', 'OTHER']).nullable(),
  revenueGeography: z.array(z.object({ country, share: z.number().min(0).max(1) }).strict()),
  regulatoryJurisdictions: z.array(country), sector: z.string().nullable(),
  commodityRevenueShare: z.number().min(0).max(1).nullable(), exportRevenueShare: z.number().min(0).max(1).nullable(),
  sourceReferences: z.record(z.string(), z.string().min(1)),
}).strict().superRefine((v, ctx) => {
  if (v.revenueGeography.reduce((sum, r) => sum + r.share, 0) > 1.000001 || new Set(v.revenueGeography.map(r => r.country)).size !== v.revenueGeography.length)
    ctx.addIssue({ code: 'custom', path: ['revenueGeography'], message: 'Revenue countries must be unique and shares must total at most 100%' });
});
export type MarketContext = z.infer<typeof MarketContext>;
export const MarketIssue = z.object({ code: z.string(), severity: z.enum(['BLOCK', 'WARN']), detail: z.string(), sourceReferences: z.array(z.string()) }).strict();
export type MarketIssue = z.infer<typeof MarketIssue>;
export const AgentId = z.enum(['FinancialStatementAgent', 'MarketMacroAgent', 'CountryRiskAgent', 'SectorSpecialistAgent', 'CommodityFXAgent', 'ForecastingAgent', 'DCFAgent', 'PeerValuationAgent', 'RiskAgent']);
export type AgentId = z.infer<typeof AgentId>;
export const MarketTrigger = z.discriminatedUnion('field', [
  z.object({ agent: AgentId, field: z.literal('sector'), includesAny: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ agent: AgentId, field: z.enum(['commodityRevenueShare', 'exportRevenueShare']), greaterThan: z.number().min(0).max(1) }).strict(),
]);
export const MarketProfile = z.object({
  id: z.string(), version: z.string(), country, exchanges: z.array(z.string()),
  accounting: z.array(z.string()), currency, accountingChecks: z.array(z.string()),
  macroChecks: z.array(z.string()), taxPolicy: z.string(), riskFreePolicy: z.string(), crpRequired: z.boolean(),
  peerPolicy: z.string(), minPeers: z.number().int().positive(), maxPeers: z.number().int().positive(),
  triggers: z.array(MarketTrigger).default([]),
  mandatory: z.array(AgentId), optional: z.array(AgentId), excluded: z.array(AgentId), sources: z.array(z.string().url()),
}).strict();
export type MarketProfile = z.infer<typeof MarketProfile>;
export const agentRegistry: Record<AgentId, { kind: 'reasoning' | 'engine'; dependencies: AgentId[]; purpose: string }> = {
  FinancialStatementAgent: { kind: 'reasoning', dependencies: [], purpose: 'Review accounting quality and normalization evidence. Identify missing filings; never manufacture financial statements.' },
  MarketMacroAgent: { kind: 'reasoning', dependencies: [], purpose: 'Interpret sourced inflation, rates, currency and regulatory exposure in the valuation currency.' },
  CountryRiskAgent: { kind: 'reasoning', dependencies: [], purpose: 'Interpret company exposure to sovereign risk and the sourced CRP. Never infer a sovereign rating from corporate interest coverage.' },
  SectorSpecialistAgent: { kind: 'reasoning', dependencies: [], purpose: 'Identify evidenced sector economics, suitable metrics and economically comparable peers.' },
  CommodityFXAgent: { kind: 'reasoning', dependencies: [], purpose: 'Review commodity/export exposure, debt currencies and hedges; link risks to forecast assumptions.' },
  ForecastingAgent: { kind: 'reasoning', dependencies: ['FinancialStatementAgent', 'SectorSpecialistAgent'], purpose: 'Select evidence-backed forecast drivers and justify scenarios. Arithmetic belongs to engines.' },
  DCFAgent: { kind: 'engine', dependencies: ['ForecastingAgent'], purpose: 'Validate the market/currency basis and expose deterministic valuation readiness.' },
  PeerValuationAgent: { kind: 'reasoning', dependencies: ['SectorSpecialistAgent'], purpose: 'Assess peer suitability under profile rules, issuer duplicates and currency/period comparability; do not invent multiples.' },
  RiskAgent: { kind: 'reasoning', dependencies: ['DCFAgent', 'PeerValuationAgent'], purpose: 'Reconcile findings. Every risk must name a forecast, discount-rate or terminal-value scenario assumption and cite its evidence.' },
};
const common: AgentId[] = ['FinancialStatementAgent', 'SectorSpecialistAgent', 'ForecastingAgent', 'DCFAgent', 'PeerValuationAgent', 'RiskAgent'];
/** Versioned serializable configuration; no dispatch logic changes when adding a profile. */
export const marketProfiles: MarketProfile[] = [
  { id: 'US.USGAAP.USD', version: '1.1.0', country: 'US', exchanges: ['NYSE', 'NASDAQ', 'XNYS', 'XNAS', 'NYSE_AMERICAN'], accounting: ['US_GAAP'], currency: 'USD',
    accountingChecks: ['ASC 842 leases', 'Stock compensation and dilution', 'ASC 606 revenue recognition'], macroChecks: ['Treasury curve', 'Inflation', 'Rate-sensitive demand'],
    taxPolicy: 'Source combined marginal federal/state tax and effective operating tax; no universal 24.5% default.', riskFreePolicy: 'Use sourced default-free USD rate with the same nominal/real basis as cash flows.', crpRequired: false,
    peerPolicy: 'Economic sector, business mix, geography and size; issuer deduplication across ADRs and share classes. Same exchange is a preference.', minPeers: 4, maxPeers: 10,
    mandatory: common, optional: ['MarketMacroAgent', 'CountryRiskAgent', 'CommodityFXAgent'], excluded: [], sources: ['https://www.sec.gov/edgar', 'https://fred.stlouisfed.org/series/DGS10'] },
  { id: 'BR.IFRS.BRL', version: '1.1.0', country: 'BR', exchanges: ['B3', 'BVMF', 'BOVESPA'], accounting: ['IFRS'], currency: 'BRL',
    accountingChecks: ['CVM/IFRS filing basis', 'JCP classification', 'BNDES borrowing terms', 'Related parties and contingencies'], macroChecks: ['Selic and IPCA', 'Sovereign spread', 'Export and commodity exposure'],
    taxPolicy: 'Source issuer-specific IRPJ/CSLL and JCP effects; turnover taxes are not an income tax rate.', riskFreePolicy: 'NTN-B is a real sovereign yield: remove default risk and convert to nominal using sourced expected inflation when forecasting nominal BRL.', crpRequired: true,
    peerPolicy: 'Prefer comparable B3 issuers; disclose governance differences. Global peers require comparability review, not an arbitrary haircut.', minPeers: 3, maxPeers: 10,
    mandatory: [...common, 'MarketMacroAgent', 'CountryRiskAgent'], optional: ['CommodityFXAgent'], excluded: [], sources: ['https://www.gov.br/cvm/', 'https://www.bcb.gov.br/', 'https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ctryprem.html'] },
  { id: 'CH.IFRS.CHF', version: '1.1.0', country: 'CH', exchanges: ['XSWX', 'SIX', 'SWX'], accounting: ['IFRS', 'SWISS_GAAP_FER'], currency: 'CHF',
    accountingChecks: ['Confirm IFRS versus Swiss GAAP FER', 'Pensions and leases', 'Segment and currency exposure'], macroChecks: ['CHF yield curve', 'SNB policy', 'Foreign revenue and currency exposure'],
    taxPolicy: 'Source the issuer canton and combined effective/marginal tax; no country-wide corporate tax default.', riskFreePolicy: 'Use a sourced CHF default-free rate consistent with cash-flow inflation basis.', crpRequired: false,
    peerPolicy: 'Comparable SIX and global issuers, normalized accounting/periods; deduplicate issuer share classes.', minPeers: 4, maxPeers: 10,
    mandatory: [...common, 'MarketMacroAgent'], optional: ['CountryRiskAgent', 'CommodityFXAgent'], excluded: [], sources: ['https://www.snb.ch/', 'https://www.six-group.com/'] },
].map(p => MarketProfile.parse(p));
export const MarketPlan = z.object({
  version: z.literal('1.1.0'), context: MarketContext, profiles: z.array(MarketProfile), hybrid: z.boolean(),
  nodes: z.array(z.object({ id: AgentId, kind: z.enum(['reasoning', 'engine']), dependencies: z.array(AgentId), reason: z.string() }).strict()),
  issues: z.array(MarketIssue), valuationMethod: z.enum(['FCFF', 'FCFE_REVIEW']),
}).strict();
export type MarketPlan = z.infer<typeof MarketPlan>;
export function buildMarketPlan(input: MarketContext, profiles = marketProfiles): MarketPlan {
  const context = MarketContext.parse(input);
  const applicable = profiles.filter(p => p.exchanges.some(e => context.listingExchanges.includes(e)) || p.country === context.incorporationCountry
    || context.regulatoryJurisdictions.includes(p.country) || context.revenueGeography.some(r => r.country === p.country && r.share > .4));
  const issues: MarketIssue[] = [];
  const issue = (code: string, detail: string, severity: 'BLOCK' | 'WARN' = 'BLOCK') => issues.push({ code, detail, severity, sourceReferences: [] });
  if (!applicable.length) issue('unsupported_market', 'No reviewed profile matches the supplied listing or issuer jurisdiction.');
  for (const key of ['incorporationCountry', 'reportingCurrency', 'accountingStandard', 'revenueGeography', 'regulatoryJurisdictions'] as const) {
    if (context[key] == null || Array.isArray(context[key]) && context[key].length === 0) issue(`missing_${key}`, `${key} is unknown; verify it before valuation.`);
    else if (!context.sourceReferences[key]) issue(`unsourced_${key}`, `${key} requires a filing or reviewed source reference.`);
  }
  if (context.revenueGeography.length && Math.abs(context.revenueGeography.reduce((s, r) => s + r.share, 0) - 1) > .000001) issue('partial_revenue_geography', 'Revenue geography covers less than 100%; country-risk exposure remains incomplete.');
  for (const p of applicable) if (context.accountingStandard && !p.accounting.includes(context.accountingStandard)) issue('accounting_profile_review', `${p.id} is selected by jurisdiction or exposure, but ${context.accountingStandard} needs separate accounting review.`, 'WARN');
  const selected = new Set<AgentId>(applicable.flatMap(p => p.mandatory));
  for (const p of applicable) for (const trigger of p.triggers) {
    const active = trigger.field === 'sector' ? trigger.includesAny.some(term => (context.sector ?? '').toLowerCase().includes(term.toLowerCase()))
      : context[trigger.field] != null && context[trigger.field]! > trigger.greaterThan;
    if (active) selected.add(trigger.agent);
  }
  if (!applicable.length) common.forEach(a => selected.add(a));
  const countries = new Set(context.revenueGeography.filter(r => r.share > 0).map(r => r.country));
  if (applicable.some(p => p.crpRequired) || [...countries].some(c => !['US', 'CH'].includes(c))) selected.add('CountryRiskAgent');
  if (applicable.length > 1 || /bank|utility|utilities|reit|real estate/i.test(context.sector ?? '')) selected.add('MarketMacroAgent');
  if ((context.commodityRevenueShare ?? 0) > .3 || (context.exportRevenueShare ?? 0) > .4 || /commodity|energy|material|oil|mining|agribusiness/i.test(context.sector ?? '')) selected.add('CommodityFXAgent');
  if (selected.has('CommodityFXAgent')) selected.add('MarketMacroAgent');
  // A conflict is explicit; mandatory work must never be silently excluded.
  for (const p of applicable) for (const id of p.excluded) if (selected.has(id)) issue('agent_policy_conflict', `${p.id} excludes required ${id}.`);
  const dependencies = (id: AgentId): AgentId[] => [...agentRegistry[id].dependencies,
    ...(id === 'ForecastingAgent' ? (['MarketMacroAgent', 'CountryRiskAgent', 'CommodityFXAgent'] as AgentId[]).filter(a => selected.has(a)) : [])];
  for (const id of selected) for (const dep of dependencies(id)) selected.add(dep);
  const nodes: MarketPlan['nodes'] = [];
  const pending = new Set(selected);
  while (pending.size) {
    const ready = [...pending].filter(id => dependencies(id).every(d => nodes.some(n => n.id === d))).sort();
    if (!ready.length) throw new Error('Market agent dependency cycle or missing dependency');
    for (const id of ready) { nodes.push({ id, kind: agentRegistry[id].kind, dependencies: dependencies(id), reason: agentRegistry[id].purpose }); pending.delete(id); }
  }
  return MarketPlan.parse({ version: '1.1.0', context, profiles: applicable, hybrid: applicable.length > 1, nodes, issues,
    valuationMethod: /bank|insurance|financial/i.test(context.sector ?? '') ? 'FCFE_REVIEW' : 'FCFF' });
}

export function marketContextFromRecord(record: { exchange: string; sector: string | null; sourceUrl?: string; attributes?: Record<string, unknown> }): MarketContext {
  const a = record.attributes ?? {};
  const ref = record.sourceUrl ?? 'identity:exchange';
  const sources: Record<string, string> = { listingExchanges: ref };
  const text = (key: string, pattern: RegExp) => typeof a[key] === 'string' && pattern.test(a[key] as string) ? String(a[key]) : null;
  const incorporationCountry = text('incorporation_country', /^[A-Z]{2}$/);
  const reportingCurrency = text('reporting_currency', /^[A-Z]{3}$/);
  const standard = text('accounting_standard', /^(IFRS|US_GAAP|SWISS_GAAP_FER|OTHER)$/);
  const regulatory = text('regulatory_jurisdiction', /^[A-Z]{2}$/);
  let revenue: MarketContext['revenueGeography'] = [];
  try { if (typeof a.revenue_geography === 'string') revenue = z.array(z.object({ country, share: z.number().min(0).max(1) }).strict()).parse(JSON.parse(a.revenue_geography)); } catch { /* missing, never inferred from listing */ }
  for (const [key, present] of Object.entries({ incorporationCountry, reportingCurrency, accountingStandard: standard, regulatoryJurisdictions: regulatory, revenueGeography: revenue.length })) if (present) sources[key] = ref;
  const context = { incorporationCountry, listingExchanges: [record.exchange.toUpperCase()], reportingCurrency, accountingStandard: standard,
    regulatoryJurisdictions: regulatory ? [regulatory] : [], revenueGeography: revenue, sector: record.sector,
    commodityRevenueShare: typeof a.commodity_revenue_share === 'number' ? a.commodity_revenue_share : null,
    exportRevenueShare: typeof a.export_revenue_share === 'number' ? a.export_revenue_share : null, sourceReferences: sources };
  const result = MarketContext.safeParse(context);
  return result.success ? result.data : MarketContext.parse({ ...context, revenueGeography: [], commodityRevenueShare: null, exportRevenueShare: null });
}
export const AgentFinding = z.object({
  status: z.enum(['complete', 'insufficient_data']),
  claims: z.array(z.object({ statement: z.string().min(1), evidenceRefs: z.array(z.string()).min(1) }).strict()),
  risks: z.array(z.object({ statement: z.string().min(1), evidenceRefs: z.array(z.string()).min(1),
    assumption: z.enum(['growth', 'margin', 'reinvestment', 'discount_rate', 'terminal_growth', 'peer_selection']),
    scenario: z.enum(['worst_case', 'base_case', 'optimistic_case']), direction: z.enum(['increase', 'decrease', 'review']) }).strict()),
  missingInputs: z.array(z.string()),
}).strict();
export type AgentFinding = z.infer<typeof AgentFinding>;
export const MarketAnalysis = z.object({
  plan: MarketPlan, executions: z.array(z.object({ agent: AgentId, status: z.enum(['complete', 'insufficient_data', 'blocked', 'error']),
    finding: AgentFinding.nullable(), detail: z.string() }).strict()),
  conflicts: z.array(MarketIssue), generatedAt: z.string().datetime(),
}).strict();
export type MarketAnalysis = z.infer<typeof MarketAnalysis>;
