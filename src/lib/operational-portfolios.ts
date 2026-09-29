import { ThesisCriteria } from '@portfolio-intelligence/agentic-contract';

export function activeThesisPortfolioRoles(theses: Array<{
  criteriaJson: unknown;
  excludedAt: Date | null;
  supersededAt: Date | null;
}>): Set<string> {
  const active = theses.find(thesis => !thesis.excludedAt && !thesis.supersededAt);
  if (!active) return new Set();
  const parsed = ThesisCriteria.safeParse(active.criteriaJson);
  if (!parsed.success) return new Set();
  return new Set(parsed.data.portfolios.filter(mandate => mandate.role !== 'not_suitable').map(mandate => mandate.role));
}

/**
 * Empty containers exist only to serve an active thesis mandate. A container
 * with holdings remains operational even after its mandate is excluded so the
 * application cannot conceal invested assets.
 */
export function operationalPortfolioIds(
  portfolioRows: Array<{ id: string; portfolioType: string }>,
  holdingPortfolioIds: Set<string>,
  activeRoles: Set<string>,
): Set<string> {
  return new Set(portfolioRows
    .filter(portfolio => activeRoles.has(portfolio.portfolioType) || holdingPortfolioIds.has(portfolio.id))
    .map(portfolio => portfolio.id));
}
