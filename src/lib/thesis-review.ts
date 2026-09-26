import type { ThesisCriteria } from '@portfolio-intelligence/agentic-contract';
import { normalizeThesisCriteriaCurrencies } from './thesis-currency';

const cleanList = (values: string[]) => values.map(value => value.trim()).filter(Boolean);
const comparisonKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

export function prepareThesisCriteria(criteria: ThesisCriteria): ThesisCriteria {
  return normalizeThesisCriteriaCurrencies({
    ...criteria,
    globalConstraints: cleanList(criteria.globalConstraints),
    portfolios: criteria.portfolios.map(portfolio => ({
      ...portfolio,
      role: portfolio.role.trim(),
      objective: portfolio.objective.trim(),
      inclusionCriteria: cleanList(portfolio.inclusionCriteria),
      exclusionCriteria: cleanList(portfolio.exclusionCriteria),
      targetMetrics: portfolio.targetMetrics && Object.fromEntries(Object.entries(portfolio.targetMetrics).map(([key, value]) => [key, value.trim()])),
    })),
  });
}

/** Deterministic checks identify explicit conflicts, not the meaning of arbitrary prose. */
export function assessThesisReview(input: ThesisCriteria) {
  const criteria = prepareThesisCriteria(input);
  const errors: string[] = [];
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
    if (!portfolio.inclusionCriteria.length) warnings.push(`${label}: no explicit selection criteria. Discovery may be too broad.`);
    if (!portfolio.exclusionCriteria.length) warnings.push(`${label}: no explicit exclusions recorded.`);
    if (!expected) warnings.push(`${label}: automatic equity discovery is not configured for this destination.`);
    for (const [key, value] of Object.entries(portfolio.targetMetrics ?? {})) {
      if (!key.trim() || !value) errors.push(`${label}: target metrics need both a name and a value with its intended units or basis.`);
    }
  }
  if (!criteria.globalConstraints.length) warnings.push('No portfolio-wide constraints recorded. Review time horizon, liquidity needs, risk limits and review cadence.');
  return { criteria, errors, warnings };
}
