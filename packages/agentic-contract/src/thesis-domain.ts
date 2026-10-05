import type { ThesisCriteria, SecurityUniverseRecord } from './index.js';
import type { z } from 'zod';
import type { EligibilityRuleResult } from './discovery-domain.js';
type Mandate = ThesisCriteria['portfolios'][number];
const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const sectorKey = (s: string) => ({ tech: 'information technology', technology: 'information technology', financial: 'financials', 'financial services': 'financials' }[key(s)] ?? key(s));
const universePaths: Record<string, string> = { 'Listing market': 'listingMarkets', Domicile: 'domicileCountries', 'Operating geography': 'operatingCountries', 'Revenue exposure': 'revenueCountries', 'Security type': 'securityTypes', 'Sector inclusion': 'sectorsIncluded', 'Sector exclusion': 'sectorsExcluded', 'Industry inclusion': 'industriesIncluded', 'Industry exclusion': 'industriesExcluded' };
export type ThesisEvaluationCluster = 'mandate' | 'universe' | 'evidence' | 'ranking' | 'audit';
export interface ThesisIssue {
  severity: 'blocking' | 'warning' | 'info';
  cluster: ThesisEvaluationCluster;
  location: string;
  statement: string;
  reason: string;
  interpretation: string;
  proxy?: string;
}
const vague =
  /\b(quality|strong balance sheet|high growth|reasonable valuation|dominant|brazilian company|swiss company|defensive|good management)\b/i;
const b3Listing = /\b(b3|bvmf)\b/i;
const retail = /\bretail\b/i;
const judicialRecovery = /judicial recovery|recupera(?:c|ç)(?:a|ã)o judicial/i;
const portfolioContext = /^(investor profile:|strategy scope:|liquidity context:|profiling framework|risk posture:|review cadence:|100% equity scope|fixed income and other asset classes)/i;
const sameStatement = (a: string, b: string) => key(a) === key(b);

function hasExplicitRule(p: Mandate, statement: string) {
  return p.policy?.rules.some(rule => sameStatement(rule.statement, statement)) ?? false;
}

function legacyConstraintIsStructured(p: Mandate, statement: string) {
  const policy = p.policy;
  if (!policy) return false;
  if (b3Listing.test(statement) && policy.universe.listingMarkets.includes('BVMF')) return true;
  if (retail.test(statement) && policy.universe.sectorsExcluded.some(value => sectorKey(value) === 'retail')) return true;
  if (judicialRecovery.test(statement) && policy.rules.some(rule => rule.kind === 'hard' && rule.predicate?.field === 'judicial_recovery_status')) return true;
  return hasExplicitRule(p, statement);
}

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
    cluster: ThesisEvaluationCluster = 'audit',
  ) =>
    issues.push({
      severity,
      cluster,
      location,
      statement,
      reason,
      interpretation,
      proxy,
    });

  // Portfolio-wide context is evaluated once. It is not repeated as a security
  // eligibility warning for every sleeve.
  for (const statement of criteria.globalConstraints) {
    if (portfolioContext.test(statement)) {
      add(
        'info',
        'portfolio-wide',
        statement,
        'Portfolio construction context.',
        'Retained for mandate governance and human review; it does not screen individual securities.',
        undefined,
        'mandate',
      );
    } else {
      add(
        'warning',
        'portfolio-wide',
        statement,
        'Portfolio-wide prose has no explicit enforcement classification.',
        'Classify it as mandate context or move a security-level restriction into the relevant structured universe/evidence rule.',
        undefined,
        'mandate',
      );
    }
  }

  for (const p of criteria.portfolios) {
    const policy = p.policy;
    for (const statement of [
      ...p.inclusionCriteria,
      ...Object.entries(p.targetMetrics ?? {}).map(([k, v]) => `${k}: ${v}`),
    ]) {
      if (legacyConstraintIsStructured(p, statement)) continue;
      add(
        'warning',
        p.role,
        statement,
        'Unclassified selection prose.',
        'Move this into a structured preference, universe restriction or explicit predicate so its effect is unambiguous.',
        undefined,
        'ranking',
      );
    }
    for (const statement of p.exclusionCriteria) {
      if (legacyConstraintIsStructured(p, statement)) continue;
      add(
        'warning',
        p.role,
        statement,
        'Unclassified exclusion prose.',
        'A security cannot be rejected from prose alone. Move this into a structured universe restriction or an evidence/metric predicate.',
        undefined,
        'evidence',
      );
    }
    if (!policy) {
      add(
        'warning',
        p.role,
        p.objective,
        'No explicit structured universe.',
        'Only the configured role market is searched: Swiss Quality → XSWX; Brazilian Growth → BVMF. Domicile and revenue are not inferred.',
        undefined,
        'universe',
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
        undefined,
        'universe',
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
            undefined,
            'universe',
          );
    for (const v of u.listingMarkets)
      if (!/^[A-Z0-9]{4}$/.test(v))
        add(
          'blocking',
          p.role,
          v,
          'Listing market requires a four-character MIC.',
          'Use BVMF for B3 or XSWX for SIX.',
          undefined,
          'universe',
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
        undefined,
        'universe',
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
        undefined,
        'mandate',
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
            undefined,
            'audit',
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
      if (r.kind === 'hard' && !r.metric && !r.predicate)
        add(
          'warning',
          p.role,
          r.statement,
          'Hard rule is missing an enforceable predicate.',
          'Add a numeric metric, provider attribute, or evidence predicate. Until then Discovery cannot certify eligibility.',
          undefined,
          'evidence',
        );
      if (!r.metric && !r.predicate && vague.test(r.statement))
        add(
          r.kind === 'hard' ? 'warning' : 'info',
          p.role,
          r.statement,
          'Qualitative term has no stated measurement basis.',
          r.kind === 'context'
            ? 'Context only; no screening effect.'
            : r.kind === 'preference'
              ? 'Ranking preference only; the system does not invent a threshold.'
              : 'Unverified hard rule; does not establish eligibility.',
          'Consider ROIC, FCF conversion, leverage, margins, or revenue/earnings stability with an explicit unit and period.',
          r.kind === 'context' ? 'mandate' : r.kind === 'preference' ? 'ranking' : 'evidence',
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
          undefined,
          'audit',
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
        undefined,
        'audit',
      );
    if (/long.term/i.test(prose) && /short.term catalyst/i.test(prose))
      add(
        'warning',
        p.role,
        'Horizon and catalyst',
        'Check whether a short-term event is essential to a long-term mandate.',
        'A catalyst can complement a long-term thesis; clarify dependency.',
        undefined,
        'audit',
      );
    if (!policy.rules.some((r) => r.category === 'risk'))
      add(
        'info',
        p.role,
        'Risk framework',
        'No explicit risk rules.',
        'Consider leverage, liquidity and concentration; no default limits imposed.',
        undefined,
        'audit',
      );
  }
  return issues;
}

export function thesisDiscoveryPlan(criteria: ThesisCriteria) {
  return criteria.portfolios.map((p) => {
    const policy = p.policy;
    const universeItems = policy ? Object.entries(policy.universe).flatMap(([field, values]) => values.map(value => `${field}: ${value}`)) : [];
    const evidenceItems = policy?.rules.filter(rule => rule.kind === 'hard' && rule.predicate?.mode === 'evidence').map(rule => rule.statement) ?? [];
    const attributeItems = policy?.rules.filter(rule => rule.kind === 'hard' && rule.predicate?.mode === 'attribute').map(rule => rule.statement) ?? [];
    const preferenceItems = policy?.rules.filter(rule => rule.kind === 'preference').map(rule => rule.statement) ?? [];
    const contextItems = policy?.rules.filter(rule => rule.kind === 'context').map(rule => rule.statement) ?? [];
    return {
      role: p.role,
      name: policy?.name ?? p.role.replaceAll('_', ' '),
      reportingCurrency: p.currency,
      objective: p.objective,
      strategy: policy?.strategy, horizon: policy?.horizon, benchmark: policy?.benchmark,
      targetHoldings: policy?.targetHoldings, maximumHoldings: policy?.maximumHoldings,
      searchMarkets:
        p.role === 'swiss_quality'
          ? ['XSWX']
          : p.role === 'brazilian_growth'
            ? ['BVMF']
            : [],
      universe: policy?.universe ?? null,
      hardConstraints: policy?.rules.filter((r) => r.kind === 'hard') ?? [],
      preferences: policy?.rules.filter((r) => r.kind === 'preference') ?? [],
      contextualAssumptions: contextItems.length ? policy!.rules.filter((r) => r.kind === 'context') : [],
      legacyPreferences: p.inclusionCriteria,
      exclusions: p.exclusionCriteria,
      globalConstraints: criteria.globalConstraints,
      evaluationClusters: [
        { id: 'mandate' as const, authority: 'context_only' as const, items: [...criteria.globalConstraints, ...contextItems] },
        { id: 'universe' as const, authority: 'deterministic_gate' as const, items: [...universeItems, ...attributeItems] },
        { id: 'evidence' as const, authority: 'evidence_gate' as const, items: evidenceItems },
        { id: 'ranking' as const, authority: 'ranking_only' as const, items: preferenceItems },
        { id: 'audit' as const, authority: 'adversarial_review' as const, items: ['Check contradictions, missing evidence and cross-rule tensions before synthesis'] },
      ],
      evidencePolicy:
        'Universe and explicit attribute rules are deterministic gates. Evidence predicates require source-backed facts; missing evidence means unverified, never eligible. Preferences rank but never exclude. Mandate context never screens a security.',
    };
  });
}

/** Only explicit provider attributes establish geography; generic country/currency cannot. */
export function evaluateThesisEligibility(
  p: Mandate,
  record: SecurityUniverseRecord,
) {
  const violated: string[] = [];
  const unverified: string[] = [];
  const rules: z.infer<typeof EligibilityRuleResult>[] = [];
  const result = (criterion: string, thesisPath: string, status: z.infer<typeof EligibilityRuleResult>['status'], reason: string, sourceOverride?: unknown, observedOverride?: unknown) => {
    const attr = record.attributes;
    const source = sourceOverride ?? (criterion === 'Domicile' ? attr.issuer_identity_source_url : undefined);
    const date = observedOverride ?? (criterion === 'Domicile' ? attr.issuer_identity_observed_at : undefined);
    let sourceUrl = record.sourceUrl;
    if (typeof source === 'string') {
      try { if (['http:', 'https:'].includes(new URL(source).protocol)) sourceUrl = source; } catch { /* retain record provenance */ }
    }
    const observedAt = typeof date === 'string' && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : record.observedAt;
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
    const index = policy.rules.indexOf(r);
    const path = `${p.role}.policy.rules[${index}]`;
    const m = r.metric;
    if (m) {
      const value = a[m.field];
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        a[`${m.field}_unit`] !== m.unit ||
        a[`${m.field}_period`] !== m.period
      ) {
        unverified.push(`${r.statement}: metric, unit or period unavailable`);
        result(r.statement, path, 'UNKNOWN', 'Metric, unit or period unavailable');
        continue;
      }
      const failed = m.operator === 'gte' ? value < m.value : value > m.value;
      if (failed) violated.push(r.statement);
      result(r.statement, path, failed ? 'FAIL' : 'PASS', `${m.field}: ${value} ${m.unit} (${m.period}); ${m.operator} ${m.value}`);
      continue;
    }
    const predicate = r.predicate;
    if (!predicate) {
      unverified.push(r.statement);
      result(r.statement, path, 'UNKNOWN', 'No enforceable predicate');
      continue;
    }
    const actual = a[predicate.field];
    if (actual === null || actual === undefined || !['string', 'number', 'boolean'].includes(typeof actual)) {
      unverified.push(`${r.statement}: ${predicate.field} evidence unavailable`);
      result(r.statement, path, 'UNKNOWN', `${predicate.field} evidence unavailable`);
      continue;
    }
    const source = a[`${predicate.field}_source_url`];
    const observed = a[`${predicate.field}_observed_at`];
    const sourceKind = a[`${predicate.field}_source_kind`];
    if (predicate.mode === 'evidence') {
      const sourceOk = typeof source === 'string' && /^https?:\/\//i.test(source);
      const officialOk = predicate.sourceRequirement !== 'official' || (typeof sourceKind === 'string' && ['official', 'regulatory', 'court', 'exchange'].includes(key(sourceKind)));
      const observedMs = typeof observed === 'string' ? Date.parse(observed) : NaN;
      const freshOk = !predicate.maxAgeDays || (Number.isFinite(observedMs) && Date.now() - observedMs <= predicate.maxAgeDays * 86_400_000);
      if (!sourceOk || !officialOk || !freshOk) {
        unverified.push(`${r.statement}: source lineage or freshness requirement not satisfied`);
        result(r.statement, path, 'UNKNOWN', 'Source lineage or freshness requirement not satisfied', source, observed);
        continue;
      }
    }
    const matches = key(String(actual)) === key(predicate.value);
    const failed = predicate.operator === 'eq' ? !matches : matches;
    if (failed) violated.push(r.statement);
    result(r.statement, path, failed ? 'FAIL' : 'PASS', `${predicate.field}: ${String(actual)}; ${predicate.operator} ${predicate.value}`, source, observed);
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
