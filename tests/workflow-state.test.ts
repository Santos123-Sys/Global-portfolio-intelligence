import { describe, expect, it } from 'vitest';
import { resolveInvestmentWorkflow } from '../src/lib/workflow-state';

describe('investment workflow state', () => {
  it('locks downstream work until a strategy is approved', () => {
    const state = resolveInvestmentWorkflow({
      hasApprovedStrategy: false,
      approvedStrategyVersion: null,
      latestDiscoveryStatus: null,
      hasAcceptedResearch: false,
    });
    expect(state).toMatchObject({
      strategy: 'ready',
      discovery: 'locked',
      research: 'locked',
      portfolio: 'locked',
      nextAction: { href: '/investment-thesis' },
    });
  });

  it('marks active discovery as working and does not fabricate research completion', () => {
    const state = resolveInvestmentWorkflow({
      hasApprovedStrategy: true,
      approvedStrategyVersion: 4,
      latestDiscoveryStatus: 'running',
      hasAcceptedResearch: false,
    });
    expect(state).toMatchObject({
      strategy: 'complete',
      discovery: 'working',
      research: 'locked',
      approvedStrategyVersion: 4,
      nextAction: { href: '/ai-stock-discovery' },
    });
  });

  it('surfaces failed discovery as attention rather than complete', () => {
    const state = resolveInvestmentWorkflow({
      hasApprovedStrategy: true,
      approvedStrategyVersion: 2,
      latestDiscoveryStatus: 'failed',
      hasAcceptedResearch: false,
    });
    expect(state.discovery).toBe('attention');
    expect(state.research).toBe('locked');
  });

  it('moves the workflow to research after successful discovery', () => {
    const state = resolveInvestmentWorkflow({
      hasApprovedStrategy: true,
      approvedStrategyVersion: 3,
      latestDiscoveryStatus: 'completed',
      hasAcceptedResearch: false,
    });
    expect(state).toMatchObject({
      strategy: 'complete',
      discovery: 'complete',
      research: 'ready',
      portfolio: 'locked',
      nextAction: { href: '/research' },
    });
  });

  it('never treats research from another mandate as current workflow evidence', () => {
    const state = resolveInvestmentWorkflow({
      hasApprovedStrategy: true,
      approvedStrategyVersion: 5,
      latestDiscoveryStatus: null,
      hasAcceptedResearch: false,
    });
    expect(state.research).toBe('locked');
    expect(state.nextAction.href).toBe('/ai-stock-discovery');
  });

  it('unlocks portfolio review only after accepted research exists', () => {
    const state = resolveInvestmentWorkflow({
      hasApprovedStrategy: true,
      approvedStrategyVersion: 5,
      latestDiscoveryStatus: 'completed',
      hasAcceptedResearch: true,
    });
    expect(state).toMatchObject({
      strategy: 'complete',
      discovery: 'complete',
      research: 'complete',
      portfolio: 'ready',
      nextAction: { href: '/positions' },
    });
  });
});
