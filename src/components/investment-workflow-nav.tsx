'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/lib/i18n';
import type { InvestmentWorkflowState, WorkflowStageState } from '@/lib/workflow-state';

const labels = {
  en: ['Investment workflow', 'Portfolio strategy', 'Discover & review', 'Analysis & valuation', 'Portfolio & risk'],
  pt: ['Fluxo de investimento', 'Estratégia de portfólio', 'Descobrir e revisar', 'Análise e valuation', 'Portfólio e risco'],
  es: ['Proceso de inversión', 'Estrategia de cartera', 'Descubrir y revisar', 'Análisis y valoración', 'Cartera y riesgo'],
  de: ['Anlageprozess', 'Portfoliostrategie', 'Entdecken und prüfen', 'Analyse und Bewertung', 'Portfolio und Risiko'],
};

const steps = [
  { id: 'strategy', href: '/investment-thesis', matches: ['/investment-thesis'] },
  { id: 'discovery', href: '/ai-stock-discovery', matches: ['/ai-stock-discovery'] },
  { id: 'research', href: '/research', matches: ['/research', '/security/', '/workspace/'] },
  { id: 'portfolio', href: '/positions', matches: ['/positions', '/allocation', '/risk', '/governance'] },
] as const;

type StageDisplayState = WorkflowStageState | 'current';

function stageLabel(state: StageDisplayState): string {
  if (state === 'complete') return 'Complete';
  if (state === 'working') return 'Working';
  if (state === 'attention') return 'Attention';
  if (state === 'ready') return 'Ready';
  if (state === 'locked') return 'Waiting';
  return 'Current';
}

function stageState(workflow: InvestmentWorkflowState | null, id: typeof steps[number]['id']): WorkflowStageState | null {
  if (!workflow) return null;
  if (id === 'strategy') return workflow.strategy;
  if (id === 'discovery') return workflow.discovery;
  if (id === 'research') return workflow.research;
  return workflow.portfolio;
}

export function InvestmentWorkflowNav() {
  const pathname = usePathname();
  const { language } = useLanguage();
  const [workflow, setWorkflow] = useState<InvestmentWorkflowState | null>(null);
  const active = steps.findIndex(step => step.matches.some(path => path.endsWith('/') ? pathname.startsWith(path) : pathname === path));

  useEffect(() => {
    if (active === -1) return;
    const controller = new AbortController();
    fetch('/api/workflow/status', { signal: controller.signal, cache: 'no-store' })
      .then(async response => response.ok ? response.json() : null)
      .then((body: { workflow?: InvestmentWorkflowState } | null) => {
        if (!controller.signal.aborted && body?.workflow) setWorkflow(body.workflow);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [active, pathname]);

  const states = useMemo<StageDisplayState[]>(() => steps.map((step, index) => {
    const resolved = stageState(workflow, step.id);
    if (index === active && (!resolved || resolved === 'ready')) return 'current';
    if (resolved) return resolved;
    if (index < active) return 'complete';
    if (index === active) return 'current';
    return index === active + 1 ? 'ready' : 'locked';
  }), [active, workflow]);

  if (active === -1) return null;
  const copy = labels[language];

  return <nav className="investment-workflow-nav" aria-label={copy[0]}>
    <ol>{steps.map((step, index) => <li key={step.href} data-stage-state={states[index]}>
      <Link href={step.href} aria-current={active === index ? 'step' : undefined}>
        <span className="workflow-step-number" aria-hidden="true">{states[index] === 'complete' ? '✓' : index + 1}</span>
        <span>{copy[index + 1]}</span>
        <small>{stageLabel(states[index])}</small>
      </Link>
    </li>)}</ol>
  </nav>;
}
