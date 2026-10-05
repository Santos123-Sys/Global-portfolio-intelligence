import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const setupPage = readFileSync('src/app/portfolio-setup/page.tsx', 'utf8');
const positionsPage = readFileSync('src/app/positions/page.tsx', 'utf8');
const header = readFileSync('src/components/header.tsx', 'utf8');
const portfolioWorkspaceNav = readFileSync('src/components/portfolio-workspace-nav.tsx', 'utf8');
const workflowNav = readFileSync('src/components/investment-workflow-nav.tsx', 'utf8');
const workflowCommand = readFileSync('src/components/workflow-next-action.tsx', 'utf8');
const i18n = readFileSync('src/lib/i18n.tsx', 'utf8');

describe('discovery-first workflow', () => {
  it('does not make a position a prerequisite for discovery', () => {
    expect(setupPage).toContain("redirect('/positions#add-position')");
    expect(positionsPage).toContain('Approving a research candidate does not add a holding automatically.');
    expect(positionsPage).toContain('Record a holding');
  });

  it('puts the governed investment workflow in the persistent workspace navigation', () => {
    expect(header).toContain("['/investment-thesis', 'nav.thesis', 'Mandate']");
    expect(header).toContain("['/ai-stock-discovery', 'nav.discover', 'Screen']");
    expect(header).toContain("['/research', 'nav.analysis', 'Research']");
    expect(header).toContain("['/positions', 'nav.portfolio', 'Portfolio']");
    expect(header).toContain("['/governance', 'nav.investmentControl']");
    expect(header).toContain("['/research-operations', 'nav.researchOperations']");
    expect(header).toContain("['/agent-settings', 'nav.agentSettings']");
    expect(header).toContain("['/account/security', 'nav.accountSecurity']");
    expect(header).toContain('workspace-sidebar');
    expect(header).toContain('workspace-topbar');
    expect(header).toContain('pathname.startsWith(\'/admin\')');

    expect(header).not.toContain("['/research-history', 'nav.adminActivity']");
    expect(header).not.toContain("['/agentic-system', 'nav.existingHoldingsAnalysis']");
    expect(header).not.toContain("['/decisions', 'nav.decisionLog']");
    expect(header).not.toContain("['/candidates', 'nav.candidateRecords']");
    expect(header).not.toContain("['/securities', 'nav.securities']");

    expect(workflowNav).toContain("fetch('/api/workflow/status'");
    expect(workflowCommand).toContain('Next action');
    expect(workflowCommand).toContain('workflow.nextAction.href');

    expect(i18n).toContain("'nav.investmentControl': 'Investment Control'");
    expect(i18n).toContain("'nav.researchOperations': 'Research Operations'");
    expect(i18n).toContain("'nav.adminPanel': 'Admin'");
    expect(portfolioWorkspaceNav).toContain("['/positions', 'Positions']");
    expect(portfolioWorkspaceNav).toContain("['/allocation', 'Allocation']");
    expect(portfolioWorkspaceNav).toContain("['/risk', 'Risk']");
    expect(portfolioWorkspaceNav).toContain("['/governance', 'Investment control']");
  });
});
