import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const setupPage = readFileSync('src/app/portfolio-setup/page.tsx', 'utf8');
const positionsPage = readFileSync('src/app/positions/page.tsx', 'utf8');
const header = readFileSync('src/components/header.tsx', 'utf8');
const portfolioWorkspaceNav = readFileSync('src/components/portfolio-workspace-nav.tsx', 'utf8');
const i18n = readFileSync('src/lib/i18n.tsx', 'utf8');

describe('discovery-first workflow', () => {
  it('does not make a position a prerequisite for discovery', () => {
    expect(setupPage).toContain("redirect('/positions#add-position')");
    expect(positionsPage).toContain('Approving a research candidate does not add a holding automatically.');
    expect(positionsPage).toContain('Record a holding');
  });

  it('puts the investment workflow in primary navigation and related portfolio tools in one workspace', () => {
    expect(header).toContain("['/investment-thesis', 'nav.thesis']");
    expect(header).toContain("['/ai-stock-discovery', 'nav.discover']");
    expect(header).toContain("['/positions', 'nav.portfolio']");
    expect(header).toContain("['/how-it-works', 'nav.howItWorks']");
    expect(header).toContain("['/research', 'nav.analysis']");
    expect(header).toContain("['/governance', 'nav.investmentControl']");
    expect(header).toContain("['/research-operations', 'nav.researchOperations']");
    expect(header).not.toContain("['/research-history', 'nav.adminActivity']");
    expect(header).not.toContain("['/agentic-system', 'nav.existingHoldingsAnalysis']");
    expect(header).not.toContain("['/decisions', 'nav.decisionLog']");
    expect(header).not.toContain("['/candidates', 'nav.candidateRecords']");
    expect(header).not.toContain("['/securities', 'nav.securities']");
    expect(header).toContain("['/agent-settings', 'nav.agentSettings']");
    expect(header).toContain("['/account/security', 'nav.accountSecurity']");
    expect(i18n).toContain("'nav.investmentReview': 'Investment Review'");
    expect(i18n).toContain("'nav.researchInbox': 'Research & Analysis Inbox'");
    expect(i18n).toContain("'nav.investmentControl': 'Investment Control'");
    expect(i18n).toContain("'nav.researchOperations': 'Research Operations'");
    expect(i18n).toContain("'nav.settings': 'Settings'");
    expect(i18n).toContain("'nav.thesis': '1. Thesis'");
    expect(i18n).toContain("'nav.discover': '2. Discover'");
    expect(i18n).toContain("'nav.portfolio': '4. Portfolio'");
    expect(portfolioWorkspaceNav).toContain("['/positions', 'Positions']");
    expect(portfolioWorkspaceNav).toContain("['/allocation', 'Allocation']");
    expect(portfolioWorkspaceNav).toContain("['/risk', 'Risk']");
    expect(portfolioWorkspaceNav).toContain("['/governance', 'Investment control']");
  });
});
