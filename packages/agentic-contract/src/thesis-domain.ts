import type { ThesisCriteria, SecurityUniverseRecord } from './index.js';
import type { z } from 'zod';
import type { EligibilityRuleResult } from './discovery-domain.js';
type Mandate = ThesisCriteria['portfolios'][number];
const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const sectorKey = (s: string) => ({ tech: 'information technology', technology: 'information technology', financial: 'financials', 'financial services': 'financials' }[key(s)] ?? key(s));
const universePaths: Record<string, string> = { 'Listing market': 'listingMarkets', Domicile: 'domicileCountries', 'Operating geography': 'operatingCountries', 'Revenue exposure': 'revenueCountries', 'Security type': 'securityTypes', 'Sector inclusion': 'sectorsIncluded', 'Sector exclusion': 'sectorsExcluded', 'Industry inclusion': 'industriesIncluded', 'Industry exclusion': 'industriesExcluded' };
export interface ThesisIssue {
  severity: 'blocking' | 'warning' | 'info';
  location: string;
  statement: string;
  reason: string;
  interpretation: string;
  proxy?: string;
}
const vague =
  /\b(quality|strong balance sheet|high growth|reasonable valuation|dominant|brazilian company|swiss company|defensive|good management)\b/i;

export function reviewStructuredThesis(
  criteria: ThesisCriteria,
): ThesisIssue[] {
  const issues: ThesisIssue[] = [];
  const add = (
    severity: ThesisIssue['severity'],
    location: string,
    statement: string,
    reason: string,
    interpretation: string,
    proxy?: string,
  ) =>
    issues.push({
      severity,
      location,
      statement,
      reason,
      interpretation,
      proxy,
    });
  for (const p of criteria.portfolios) {
    const policy = p.policy;
    for (const statement of [
      ...p.inclusionCriteria,
      ...Object.entries(p.targetMetrics ?? {}).map(([k, v]) => `${k}: ${v}`),
    ]) {
      add(
        'warning',
        p.role,
        statement,
        'Legacy prose has no explicit rule classification.',
        'Retained for qualitative review; it is not a deterministic numeric filter. Move it into a classified rule to define its effect.',
      );
    }
    for (const statement of [
      ...p.exclusionCriteria,
      ...criteria.globalConstraints,
    ]) {
      add(
        'warning',
        p.role,
        statement,
        'This prose constraint cannot be verified deterministically.',
        'Discovery must assess the stated restriction from evidence and disclose uncertainty. Use structured universe fields or a metric rule for a deterministic gate.',
      );
    }
    if (!policy) {
      add(
        'warning',
        p.role,
        p.objective,
        'No explicit structured universe.',
        'Only the configured role market is searched: Swiss Quality → XSWX; Brazilian Growth → BVMF. Domicile and revenue are not inferred.',
      );
      continue;
    }
    const u = policy.universe;
    if (!(
      u.listingMarkets.length ||
      u.domicileCountries.length ||
      u.operatingCountries.length ||
      u.revenueCountries.length
    ))
      add(
        'blocking',
        p.role,
        'Universe',
        'Define at least one geography dimension.',
        'Currency does not define geography.',
      );
    for (const field of [
      'domicileCountries',
      'operatingCountries',
      'revenueCountries',
    ] as const)
      for (const v of u[field])
        if (!/^[A-Z]{2}$/.test(v))
          add(
            'blocking',
            p.role,
            v,
            `${field} requires uppercase ISO alpha-2 codes.`,
            'Use BR, CH, US, etc.',
          );
    for (const v of u.listingMarkets)
      if (!/^[A-Z0-9]{4}$/.test(v))
        add(
          'blocking',
          p.role,
          v,
          'Listing market requires a four-character MIC.',
          'Use BVMF for B3 or XSWX for SIX.',
        );
    const supported =
      p.role === 'swiss_quality'
        ? 'XSWX'
        : p.role === 'brazilian_growth'
          ? 'BVMF'
          : null;
    if (
      supported &&
      u.listingMarkets.length &&
      !u.listingMarkets.includes(supported)
    )
      add(
        'warning',
        p.role,
        u.listingMarkets.join(', '),
        'The configured Discovery market cannot satisfy this listing restriction.',
        'Thesis can be saved; Discovery will produce no eligible names until market coverage changes.',
      );
    if (
      policy.targetHoldings &&
      policy.maximumHoldings &&
      policy.targetHoldings > policy.maximumHoldings
    )
      add(
        'blocking',
        p.role,
        `${policy.targetHoldings} target / ${policy.maximumHoldings} maximum`,
        'Target holdings exceeds maximum holdings.',
        'Reduce the target or increase the mandate maximum. Discovery shortlist size is separate from holdings.',
      );
    for (const [included, excluded, label] of [
      [u.sectorsIncluded, u.sectorsExcluded, 'Sector'],
      [u.industriesIncluded, u.industriesExcluded, 'Industry'],
    ] as const) {
      for (const v of included)
        if (excluded.some((e) => (label === 'Sector' ? sectorKey(e) === sectorKey(v) : key(e) === key(v))))
          add(
            'blocking',
            p.role,
            v,
            `${label} is both required and excluded.`,
            'Remove one of the conflicting rules.',
          );
    }
    const lower = new Map<string, number>();
    const upper = new Map<string, number>();
    for (const r of policy.rules) {
      if (r.kind === 'hard' && r.metric) {
        const m = r.metric,
          k = JSON.stringify([m.field, m.unit, m.period]);
        if (m.operator === 'gte')
          lower.set(k, Math.max(lower.get(k) ?? -Infinity, m.value));
        else upper.set(k, Math.min(upper.get(k) ?? Infinity, m.value));
      }
      if (r.kind === 'hard' && !r.metric)
        add(
          'warning',
          p.role,
          r.statement,
          'Hard qualitative rule has no machine-verifiable predicate.',
          'Discovery cannot certify eligibility for this rule; add a predicate or explicitly change its classification.',
        );
      if (!r.metric && vague.test(r.statement))
        add(
          'warning',
          p.role,
          r.statement,
          'Qualitative term has no stated measurement basis.',
          r.kind === 'context'
            ? 'Context only; no screening effect.'
            : r.kind === 'preference'
              ? 'Qualitative preference; no invented threshold.'
              : 'Unverified hard rule; does not establish eligibility.',
          'Consider ROIC, FCF conversion, leverage, margins, or revenue/earnings stability with an explicit unit and period.',
        );
    }
    for (const [k, min] of lower)
      if (min > (upper.get(k) ?? Infinity))
        add(
          'blocking',
          p.role,
          k,
          'Minimum exceeds maximum for the same metric, unit and period.',
          'Correct one of the bounds.',
        );
    const prose = [
      p.objective,
      policy.strategy,
      policy.horizon,
      ...policy.rules.map((r) => r.statement),
    ].join(' ');
    if (
      /high.?growth/i.test(prose) &&
      /low valuation|low p\/?e|deep value/i.test(prose)
    )
      add(
        'warning',
        p.role,
        'Growth and valuation',
        'These preferences may sharply narrow the opportunity set, but are not logically incompatible.',
        'Review trade-offs; no automatic rejection.',
      );
    if (/long.term/i.test(prose) && /short.term catalyst/i.test(prose))
      add(
        'warning',
        p.role,
        'Horizon and catalyst',
        'Check whether a short-term event is essential to a long-term mandate.',
        'A catalyst can complement a long-term thesis; clarify dependency.',
      );
    if (!policy.rules.some((r) => r.category === 'risk'))
      add(
        'info',
        p.role,
        'Risk framework',
        'No explicit risk rules.',
        'Consider leverage, liquidity and concentration; no default limits imposed.',
      );
  }
  return issues;
}

export function thesisDiscoveryPlan(criteria: ThesisCriteria) {
  return criteria.portfolios.map((p) => ({
    role: p.role,
    name: p.policy?.name ?? p.role.replaceAll('_', ' '),
    reportingCurrency: p.currency,
    objective: p.objective,
    strategy: p.policy?.strategy, horizon: p.policy?.horizon, benchmark: p.policy?.benchmark,
    targetHoldings: p.policy?.targetHoldings, maximumHoldings: p.policy?.maximumHoldings,
    searchMarkets:
      p.role === 'swiss_quality'
        ? ['XSWX']
        : p.role === 'brazilian_growth'
          ? ['BVMF']
          : [],
    universe: p.policy?.universe ?? null,
    hardConstraints: p.policy?.rules.filter((r) => r.kind === 'hard') ?? [],
    preferences: p.policy?.rules.filter((r) => r.kind === 'preference') ?? [],
    contextualAssumptions:
      p.policy?.rules.filter((r) => r.kind === 'context') ?? [],
    legacyPreferences: p.inclusionCriteria,
    exclusions: p.exclusionCriteria,
    globalConstraints: criteria.globalConstraints,
    evidencePolicy:
      'Structured hard rules require verified matching data. Missing data means unverified, never eligible. Preferences and contextual assumptions never exclude.',
  }));
}

/** Only explicit provider attributes establish geography; generic country/currency cannot. */
export function evaluateThesisEligibility(
  p: Mandate,
  record: SecurityUniverseRecord,
) {
  const violated: string[] = [];
  const unverified: string[] = [];
  const rules: z.infer<typeof EligibilityRuleResult>[] = [];
  const result = (criterion: string, thesisPath: string, status: z.infer<typeof EligibilityRuleResult>['status'], reason: string) => {
    const attr = record.attributes;
    const source = criterion === 'Domicile' ? attr.issuer_identity_source_url : undefined;
    const date = criterion === 'Domicile' ? attr.issuer_identity_observed_at : undefined;
    let sourceUrl = record.sourceUrl;
    if (typeof source === 'string') {
      try { if (['http:', 'https:'].includes(new URL(source).protocol)) sourceUrl = source; } catch { /* retain record provenance */ }
    }
    const observedAt = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) ? `${date}T00:00:00.000Z` : record.observedAt;
    rules.push({ criterion, thesisPath, status, reason, sourceUrl, observedAt });
  };
  const policy = p.policy;
  if (!policy) {
    result('Structured eligibility', p.role, 'NOT_APPLICABLE', 'Legacy mandate: only configured listing market verified; prose requires human review');
    return { status: 'eligible' as const, violated, unverified, rules };
  }
  const u = policy.universe,
    a = record.attributes;
  function check(
    label: string,
    allowed: string[],
    actual: unknown,
    exclusion = false,
  ) {
    if (!allowed.length) return;
    if (typeof actual !== 'string' || !actual.trim()) {
      unverified.push(`${label}: evidence unavailable`);
      result(label, `${p.role}.policy.universe.${universePaths[label]}`, 'UNKNOWN', 'Evidence unavailable');
      return;
    }
    const normalize = label.startsWith('Sector') ? sectorKey : key;
    const matches = allowed.some((v) => normalize(v) === normalize(actual));
    const failed = exclusion ? matches : !matches;
    if (failed) violated.push(`${label}: ${actual}`);
    result(label, `${p.role}.policy.universe.${universePaths[label]}`, failed ? 'FAIL' : 'PASS', `${actual}; ${exclusion ? 'excluded' : 'allowed'}: ${allowed.join(', ')}`);
  }
  check('Listing market', u.listingMarkets, record.exchange);
  check('Domicile', u.domicileCountries, a.issuer_domicile_country_iso2);
  // Explicit coverage lists must be complete; do not parse narrative revenue summaries.
  for (const [label, required, attribute] of [
    ['Operating geography', u.operatingCountries, 'operating_country_iso2'],
    ['Revenue exposure', u.revenueCountries, 'revenue_country_iso2'],
  ] as const)
    check(label, required, a[attribute]);
  check('Security type', u.securityTypes, record.assetType);
  check('Sector inclusion', u.sectorsIncluded, record.sector);
  check('Sector exclusion', u.sectorsExcluded, record.sector, true);
  check('Industry inclusion', u.industriesIncluded, record.industry);
  check('Industry exclusion', u.industriesExcluded, record.industry, true);
  for (const r of policy.rules.filter((r) => r.kind === 'hard')) {
    const m = r.metric;
    if (!m) {
      unverified.push(r.statement);
      result(r.statement, `${p.role}.policy.rules[${policy.rules.indexOf(r)}]`, 'UNKNOWN', 'No measurable predicate');
      continue;
    }
    const value = a[m.field];
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      a[`${m.field}_unit`] !== m.unit ||
      a[`${m.field}_period`] !== m.period
    ) {
      unverified.push(`${r.statement}: metric, unit or period unavailable`);
      result(r.statement, `${p.role}.policy.rules[${policy.rules.indexOf(r)}]`, 'UNKNOWN', 'Metric, unit or period unavailable');
      continue;
    }
    const failed = m.operator === 'gte' ? value < m.value : value > m.value;
    if (failed) violated.push(r.statement);
    result(r.statement, `${p.role}.policy.rules[${policy.rules.indexOf(r)}]`, failed ? 'FAIL' : 'PASS', `${m.field}: ${value} ${m.unit} (${m.period}); ${m.operator} ${m.value}`);
  }
  return {
    status: violated.length
      ? ('ineligible' as const)
      : unverified.length
        ? ('unverified' as const)
        : ('eligible' as const),
    violated,
    unverified,
    rules,
  };
}

export function diffThesis(previous: ThesisCriteria, current: ThesisCriteria) {
  const flatten = (
    value: unknown,
    path = '',
    out: Record<string, string> = {},
  ) => {
    if (Array.isArray(value))
      value.forEach((v, i) => flatten(v, `${path}[${i}]`, out));
    else if (value && typeof value === 'object')
      Object.entries(value).forEach(([k, v]) => {
        if (k !== 'version') flatten(v, path ? `${path}.${k}` : k, out);
      });
    else if (value !== undefined) out[path] = String(value);
    return out;
  };
  const before = flatten(previous),
    after = flatten(current);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => before[k] !== after[k])
    .map((path) => ({
      path,
      previous: before[path] ?? null,
      current: after[path] ?? null,
      kind: !(path in before)
        ? 'added'
        : !(path in after)
          ? 'removed'
          : 'modified',
    }));
}
