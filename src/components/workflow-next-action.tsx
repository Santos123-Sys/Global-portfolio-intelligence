'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { InvestmentWorkflowState, WorkflowStageState } from '@/lib/workflow-state';
import { StatusPill, type WorkflowStatus } from '@/components/ui/status-pill';

const WORKFLOW_PATHS = ['/investment-thesis', '/ai-stock-discovery', '/research', '/positions', '/allocation', '/risk', '/governance'];

function stateLabel(state: WorkflowStageState): string {
  if (state === 'complete') return 'Complete';
  if (state === 'working') return 'Working';
  if (state === 'attention') return 'Attention';
  if (state === 'ready') return 'Ready';
  return 'Waiting';
}

function toPillStatus(state: WorkflowStageState): WorkflowStatus {
  // 'locked' (prerequisite not met) maps to the 'blocked' vocabulary term.
  if (state === 'locked') return 'blocked';
  return state;
}

export function WorkflowNextAction() {
  const pathname = usePathname();
  const [workflow, setWorkflow] = useState<InvestmentWorkflowState | null>(null);
  const visible = WORKFLOW_PATHS.includes(pathname) || pathname.startsWith('/security/') || pathname.startsWith('/workspace/');

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    fetch('/api/workflow/status', { signal: controller.signal, cache: 'no-store' })
      .then(async response => response.ok ? response.json() : null)
      .then((body: { workflow?: InvestmentWorkflowState } | null) => {
        if (!controller.signal.aborted && body?.workflow) setWorkflow(body.workflow);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [pathname, visible]);

  if (!visible || !workflow) return null;

  const stages: Array<[string, WorkflowStageState]> = [
    ['Strategy', workflow.strategy],
    ['Discovery', workflow.discovery],
    ['Research', workflow.research],
    ['Portfolio', workflow.portfolio],
  ];

  return <section className="workflow-command-bar" aria-label="Investment workflow status">
    <div className="workflow-command-state">
      {stages.map(([label, state]) => <span key={label} data-state={state}><strong>{label}</strong>
        <StatusPill status={toPillStatus(state)} />
      </span>)}
    </div>
    <div className="workflow-command-next">
      <div><span>Next action</span><strong>{workflow.nextAction.label}</strong><p>{workflow.nextAction.reason}</p></div>
      <Link className="secondary-button inline-action" href={workflow.nextAction.href}>Open</Link>
    </div>
  </section>;
}
