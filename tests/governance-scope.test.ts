import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultGovernancePolicy } from '../src/lib/governance';
import { activeThesisPortfolioRoles, operationalPortfolioIds } from '../src/lib/operational-portfolios';

const route = readFileSync('src/app/api/governance/route.ts', 'utf8');
const portfoliosRoute = readFileSync('src/app/api/portfolios/route.ts', 'utf8');
const dashboard = readFileSync('src/components/governance-dashboard.tsx', 'utf8');
const thesisPage = readFileSync('src/app/investment-thesis/page.tsx', 'utf8');
const governance = readFileSync('src/lib/governance.ts', 'utf8');

describe('investment governance controls', () => {
  it('uses transparent review guardrails rather than autonomous trading thresholds', () => {
    expect(defaultGovernancePolicy).toMatchObject({
      maxPositionWeight: 0.15,
      maxSectorWeight: 0.35,
      maxCountryWeight: 0.4,
      minimumHoldings: 5,
    });
    expect(governance).toContain('not an autonomous trading system');
    expect(dashboard).toContain('not automated trading instructions');
  });

  it('keeps policy persistence owner-scoped and mutation-protected', () => {
    expect(route).toContain('authenticateRequest(req)');
    expect(route).toContain('assertSameOrigin(req)');
    expect(route).toContain('saveGovernancePolicy(session.auth.userId');
    expect(thesisPage).toContain('Optional portfolio monitoring guardrails');
    expect(thesisPage).toContain('do not block thesis approval, Discovery, analysis, or valuation');
    expect(dashboard).not.toContain('Save guardrails');
  });

  it('surfaces freshness, provider health, committee memos, attribution, and explicit monitoring gaps', () => {
    expect(dashboard).toContain('Evidence freshness');
    expect(dashboard).toContain('Provider health');
    expect(dashboard).toContain('Investment committee memos');
    expect(dashboard).toContain('Return contribution');
    expect(governance).toContain('Earnings, leverage, management events');
    expect(governance).toContain('not_connected');
  });

  it('hides empty portfolios whose thesis mandate was excluded while retaining invested portfolios', () => {
    const activeRoles = activeThesisPortfolioRoles([{ criteriaJson: {
      version: 2,
      portfolios: [{ role: 'brazilian_growth', objective: 'Growth', inclusionCriteria: [], exclusionCriteria: [], currency: 'BRL' }],
      globalConstraints: [],
    }, excludedAt: null, supersededAt: null }]);
    const visible = operationalPortfolioIds([
      { id: 'active-empty', portfolioType: 'brazilian_growth' },
      { id: 'excluded-empty', portfolioType: 'swiss_quality' },
      { id: 'excluded-invested', portfolioType: 'legacy_income' },
    ], new Set(['excluded-invested']), activeRoles);
    expect([...activeRoles]).toEqual(['brazilian_growth']);
    expect([...visible]).toEqual(['active-empty', 'excluded-invested']);
    expect(portfoliosRoute).toContain('operationalPortfolioIds');
  });

  it('treats excluded thesis versions as historical and not operational', () => {
    const roles = activeThesisPortfolioRoles([{ criteriaJson: {
      version: 1,
      portfolios: [{ role: 'swiss_quality', objective: 'Quality', inclusionCriteria: [], exclusionCriteria: [], currency: 'CHF' }],
      globalConstraints: [],
    }, excludedAt: new Date(), supersededAt: new Date() }]);
    expect(roles.size).toBe(0);
  });
});
