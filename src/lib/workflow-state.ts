export type WorkflowStageState = 'complete' | 'working' | 'attention' | 'ready' | 'locked';
export type WorkflowRoute = '/investment-thesis' | '/ai-stock-discovery' | '/research' | '/positions';

export type WorkflowSnapshotInput = {
  hasApprovedStrategy: boolean;
  approvedStrategyVersion: number | null;
  latestDiscoveryStatus: string | null;
  hasAcceptedResearch: boolean;
};

export type InvestmentWorkflowState = {
  strategy: WorkflowStageState;
  discovery: WorkflowStageState;
  research: WorkflowStageState;
  portfolio: WorkflowStageState;
  approvedStrategyVersion: number | null;
  nextAction: {
    href: WorkflowRoute;
    label: string;
    reason: string;
  };
};

const WORKING_DISCOVERY = new Set(['dispatching', 'queued', 'running']);

export function resolveInvestmentWorkflow(input: WorkflowSnapshotInput): InvestmentWorkflowState {
  if (!input.hasApprovedStrategy) {
    return {
      strategy: 'ready',
      discovery: 'locked',
      research: 'locked',
      portfolio: 'locked',
      approvedStrategyVersion: null,
      nextAction: {
        href: '/investment-thesis',
        label: 'Define and approve strategy',
        reason: 'Discovery cannot start until a current portfolio strategy is approved.',
      },
    };
  }

  const discoveryStatus = input.latestDiscoveryStatus;
  if (!discoveryStatus) {
    return {
      strategy: 'complete',
      discovery: 'ready',
      research: 'locked',
      portfolio: input.hasAcceptedResearch ? 'ready' : 'locked',
      approvedStrategyVersion: input.approvedStrategyVersion,
      nextAction: {
        href: '/ai-stock-discovery',
        label: 'Start thesis-matched discovery',
        reason: 'The mandate is approved and no Discovery run exists for the current workflow.',
      },
    };
  }

  if (WORKING_DISCOVERY.has(discoveryStatus)) {
    return {
      strategy: 'complete',
      discovery: 'working',
      research: input.hasAcceptedResearch ? 'complete' : 'locked',
      portfolio: input.hasAcceptedResearch ? 'ready' : 'locked',
      approvedStrategyVersion: input.approvedStrategyVersion,
      nextAction: {
        href: '/ai-stock-discovery',
        label: 'Monitor Discovery',
        reason: 'The Research Director is actively screening the approved universe.',
      },
    };
  }

  if (discoveryStatus === 'failed') {
    return {
      strategy: 'complete',
      discovery: 'attention',
      research: input.hasAcceptedResearch ? 'complete' : 'locked',
      portfolio: input.hasAcceptedResearch ? 'ready' : 'locked',
      approvedStrategyVersion: input.approvedStrategyVersion,
      nextAction: {
        href: '/ai-stock-discovery',
        label: 'Resolve Discovery failure',
        reason: 'The latest Discovery run failed and must be reviewed or retried before relying on its result.',
      },
    };
  }

  if (input.hasAcceptedResearch) {
    return {
      strategy: 'complete',
      discovery: 'complete',
      research: 'complete',
      portfolio: 'ready',
      approvedStrategyVersion: input.approvedStrategyVersion,
      nextAction: {
        href: '/positions',
        label: 'Review portfolio implications',
        reason: 'Accepted research exists; portfolio decisions remain explicitly human-controlled.',
      },
    };
  }

  return {
    strategy: 'complete',
    discovery: discoveryStatus === 'completed' ? 'complete' : 'attention',
    research: discoveryStatus === 'completed' ? 'ready' : 'locked',
    portfolio: 'locked',
    approvedStrategyVersion: input.approvedStrategyVersion,
    nextAction: discoveryStatus === 'completed'
      ? {
          href: '/research',
          label: 'Review company research',
          reason: 'Discovery finished; review accepted evidence and analysis before a portfolio decision.',
        }
      : {
          href: '/ai-stock-discovery',
          label: 'Review Discovery status',
          reason: 'The latest Discovery run is not in a terminal successful state.',
        },
  };
}
