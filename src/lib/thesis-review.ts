import { reviewStructuredThesis, ThesisPolicy, emptyThesisPolicy, type ThesisCriteria, type ThesisRule } from '@portfolio-intelligence/agentic-contract';
import { normalizeThesisCriteriaCurrencies } from './thesis-currency';

const cleanList = (values: string[]) => values.map(value => value.trim()).filter(Boolean);
const comparisonKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const matchesB3Listing = (value: string) => /listed equities.*\b(b3|bvmf)\b|\b(b3|bvmf)\b.*listed equities/i.test(value);
const matchesGrowthPreference = (value: string) => /early-stage growth companies with high growth potential/i.test(value);
const matchesRetailExclusion = (value: string) => /(?:exclude\s+)?(?:all\s+)?(?:companies|equities)?.*\bretail sector\b|\bretail sector (?:companies|equities)\b/i.test(value);
const matchesJudicialRecovery = (value: string) => /judicial recovery|recupera(?:c|ç)(?:a|ã)o judicial/i.test(value);
const matchesBroadEquityType = (value: string) => /^(?:listed\s+)?equ(?:ity|ities)$|^stocks?$/i.test(value.trim());

function ensureUnique(values: string[], value: string, normalize = comparisonKey) {
  return values.some(existing => normalize(existing) === normalize(value)) ? values : [...values, value];
}

/**
 * Known Portfolio Creator concepts are migrated into the enforcement domain
 * that owns them. This is intentionally narrow: arbitrary prose is never
 * converted into a hard rule by keyword guessing.
 */
function canonicalizeKnownMandate(portfolio: ThesisCriteria['portfolios'][number]) {
  const isBrazil = portfolio.role === 'brazilian_growth';
  if (!isBrazil) return portfolio;
  const allLegacy = [...portfolio.inclusionCriteria, ...portfolio.exclusionCriteria, ...(portfolio.policy?.rules.map(rule => rule.statement) ?? [])];
  const needsPolicy = allLegacy.some(value => matchesB3Listing(value) || matchesGrowthPreference(value) || matchesRetailExclusion(value) || matchesJudicialRecovery(value));
  if (!needsPolicy) return portfolio;

  const policy = portfolio.policy ? structuredClone(portfolio.policy) : emptyThesisPolicy();
  const inclusionCriteria = portfolio.inclusionCriteria.filter(value => !matchesB3Listing(value) && !matchesGrowthPreference(value));
  const exclusionCriteria = portfolio.exclusionCriteria.filter(value => !matchesRetailExclusion(value) && !matchesJudicialRecovery(value));

  if (portfolio.inclusionCriteria.some(matchesB3Listing)) {
    policy.universe.listingMarkets = ensureUnique(policy.universe.listingMarkets, 'BVMF', value => value.toUpperCase());
  }
  if (portfolio.exclusionCriteria.some(matchesRetailExclusion) || policy.rules.some(rule => matchesRetailExclusion(rule.statement))) {
    policy.universe.sectorsExcluded = ensureUnique(policy.universe.sectorsExcluded, 'Retail');
  }
  // B3 provider universes are already filtered to listed stocks/units. A broad
  // "equity" security-type entry is therefore redundant and, more importantly,
  // must not be compared literally with provider share-class labels such as
  // Common Stock or Preferred Stock. Specific share-class restrictions remain.
  if (policy.universe.securityTypes.some(matchesBroadEquityType)) {
    policy.universe.securityTypes = [];
  }

  const rules: ThesisRule[] = [];
  let hasGrowth = false;
  let hasJudicial = false;
  for (const rule of policy.rules) {
    if (matchesRetailExclusion(rule.statement) && rule.kind === 'hard' && !rule.metric && !rule.predicate) continue;
    if (matchesGrowthPreference(rule.statement)) {
      hasGrowth = true;
      rules.push({ ...rule, kind: 'preference', category: 'selection', metric: undefined, predicate: undefined });
      continue;
    }
    if (matchesJudicialRecovery(rule.statement) && rule.kind === 'hard') {
      hasJudicial = true;
      rules.push({
        ...rule,
        kind: 'hard',
        category: 'risk',
        metric: undefined,
        predicate: {
          mode: 'evidence',
          field: 'judicial_recovery_status',
          operator: 'eq',
          value: 'none',
          sourceRequirement: 'official',
          maxAgeDays: 90,
        },
      });
      continue;
    }
    rules.push(rule);
  }

  if (portfolio.inclusionCriteria.some(matchesGrowthPreference) && !hasGrowth) {
    rules.push({ statement: 'Early-stage growth companies with high growth potential', kind: 'preference', category: 'selection' });
  }
  if (portfolio.exclusionCriteria.some(matchesJudicialRecovery) && !hasJudicial) {
    rules.push({
      statement: 'Exclude companies currently under judicial recovery proceedings',
      kind: 'hard',
      category: 'risk',
      predicate: {
        mode: 'evidence',
        field: 'judicial_recovery_status',
        operator: 'eq',
        value: 'none',
        sourceRequirement: 'official',
        maxAgeDays: 90,
      },
    });
  }

  return { ...portfolio, inclusionCriteria, exclusionCriteria, policy: { ...policy, rules } };
}

export function prepareThesisCriteria(criteria: ThesisCriteria): ThesisCriteria {
  const normalized = normalizeThesisCriteriaCurrencies({
    ...criteria,
    globalConstraints: cleanList(criteria.globalConstraints),
    portfolios: criteria.portfolios.map(portfolio => ({
      ...portfolio,
      policy: portfolio.policy && { ...portfolio.policy, universe: Object.fromEntries(Object.entries(portfolio.policy.universe).map(([field, values]) => [field, cleanList(values)])) as NonNullable<typeof portfolio.policy>['universe'] },
      role: portfolio.role.trim(),
      objective: portfolio.objective.trim(),
      inclusionCriteria: cleanList(portfolio.inclusionCriteria),
      exclusionCriteria: cleanList(portfolio.exclusionCriteria),
      targetMetrics: portfolio.targetMetrics && Object.fromEntries(Object.entries(portfolio.targetMetrics).map(([key, value]) => [key, value.trim()])),
    })),
  });
  return { ...normalized, portfolios: normalized.portfolios.map(canonicalizeKnownMandate) };
}

const clusterLabel = {
  mandate: 'Mandate',
  universe: 'Universe',
  evidence: 'Evidence gate',
  ranking: 'Ranking',
  audit: 'Constraint audit',
} as const;

/** Deterministic checks identify explicit conflicts, not the meaning of arbitrary prose. */
export function assessThesisReview(input: ThesisCriteria) {
  const criteria = prepareThesisCriteria(input);
  const errors: string[] = [];
  const issues = reviewStructuredThesis(criteria);
  for (const p of criteria.portfolios) if (p.policy) {
    const parsed = ThesisPolicy.safeParse(p.policy);
    if (!parsed.success) errors.push(...parsed.error.issues.map(issue => `${p.role}: ${issue.path.join(' ')} — ${issue.message}`));
  }
  errors.push(...issues.filter(issue => issue.severity === 'blocking').map(issue => `${issue.location}: ${issue.reason}`));
  const warnings: string[] = [];
  const roles = new Set<string>();
  for (const portfolio of criteria.portfolios) {
    const label = portfolio.role.replaceAll('_', ' ');
    if (roles.has(portfolio.role)) errors.push(`Duplicate portfolio destination: ${label}. Combine or rename the mandates.`);
    roles.add(portfolio.role);
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(portfolio.role)) errors.push(`${label || 'Portfolio'}: use a lowercase destination identifier with underscores.`);
    if (!portfolio.objective) errors.push(`${label}: provide an investment objective.`);
    if (!/^[A-Z]{3}$/.test(portfolio.currency)) errors.push(`${label}: specify a three-letter reporting currency.`);
    const expected = portfolio.role === 'swiss_quality' ? 'CHF' : portfolio.role === 'brazilian_growth' ? 'BRL' : null;
    if (expected && portfolio.currency !== expected) errors.push(`${label}: this configured portfolio requires ${expected}.`);
    const excluded = new Set(portfolio.exclusionCriteria.map(comparisonKey));
    for (const item of portfolio.inclusionCriteria) {
      if (excluded.has(comparisonKey(item))) errors.push(`${label}: “${item}” appears in both inclusion and exclusion criteria.`);
    }
    const hasUniverseCriteria = portfolio.policy ? Object.values(portfolio.policy.universe).some(values => values.length > 0) : false;
    if (!portfolio.inclusionCriteria.length && !portfolio.policy?.rules.some(rule => rule.kind !== 'context') && !hasUniverseCriteria) warnings.push(`${label}: no explicit selection criteria. Discovery may be too broad.`);
    if (!expected) warnings.push(`${label}: automatic equity discovery is not configured for this destination.`);
    for (const [key, value] of Object.entries(portfolio.targetMetrics ?? {})) {
      if (!key.trim() || !value) errors.push(`${label}: target metrics need both a name and a value with its intended units or basis.`);
    }
  }
  warnings.push(...issues.filter(issue => issue.severity === 'warning').map(issue => `${clusterLabel[issue.cluster]} · ${issue.location} — ${issue.statement}: ${issue.interpretation}`));
  return {
    criteria,
    errors,
    warnings: [...new Set(warnings)],
    issues,
    actionableIssues: issues.filter(issue => issue.severity === 'warning'),
    contextIssues: issues.filter(issue => issue.severity === 'info'),
    needsAcknowledgment: issues.some(issue => issue.severity === 'warning'),
  };
}