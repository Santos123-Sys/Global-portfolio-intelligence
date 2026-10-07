/**
 * StatusPill — the canonical workflow-state indicator.
 *
 * Implements the product status vocabulary defined in
 * docs/COMMERCIAL-V3-UX-ARCHITECTURE.md and the architecture manual §11:
 *   ready     → prerequisites met, an action is available
 *   working   → a durable job/session is executing
 *   attention → non-blocking evidence or judgment gap
 *   blocked   → a hard prerequisite or required evidence is missing
 *   complete  → the stage has finished
 *
 * Design-system rule: a status pill never hides coverage or uncertainty —
 * pair it with a visible note when evidence is partial.
 */
import type { ReactNode } from 'react';

export type WorkflowStatus = 'ready' | 'working' | 'attention' | 'blocked' | 'complete';

const STATUS_LABEL: Record<WorkflowStatus, string> = {
  ready: 'Ready',
  working: 'Working',
  attention: 'Attention',
  blocked: 'Blocked',
  complete: 'Complete',
};

export function StatusPill({
  status,
  children,
}: {
  status: WorkflowStatus;
  /** Optional override for the visible label; defaults to the canonical term. */
  children?: ReactNode;
}) {
  return (
    <span className={`pi-status-pill pi-status-pill--${status}`} data-status={status}>
      {children ?? STATUS_LABEL[status]}
    </span>
  );
}
