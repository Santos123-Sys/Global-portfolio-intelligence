'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/lib/i18n';

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

type StageState = 'complete' | 'working' | 'current' | 'next' | 'locked';

type WorkflowSnapshot = {
  hasApprovedStrategy: boolean;
  discoveryState: 'none' | 'working' | 'complete';
  hasResearch: boolean;
};

const emptySnapshot: WorkflowSnapshot = {
  hasApprovedStrategy: false,
  discoveryState: 'none',
  hasResearch: false,
};

function stageLabel(state: StageState): string {
  if (state === 'complete') return 'Complete';
  if (state === 'working') return 'Working';
  if (state === 'current') return 'Current';
  if (state === 'locked') return 'Waiting';
  return 'Next';
}

export function InvestmentWorkflowNav() {
  const pathname = usePathname();
  const { language } = useLanguage();
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot>(emptySnapshot);
  const active = steps.findIndex(step => step.matches.some(path => path.endsWith('/') ? pathname.startsWith(path) : pathname === path));

  useEffect(() => {
    if (active === -1) return;
    const controller = new AbortController();
    Promise.allSettled([
      fetch('/api/thesis', { signal: controller.signal, cache: 'no-store' }).then(async response => response.ok ? response.json() : null),
      fetch('/api/discovery/runs', { signal: controller.signal, cache: 'no-store' }).then(async response => response.ok ? response.json() : null),
      fetch('/api/analysis', { signal: controller.signal, cache: 'no-store' }).then(async response => response.ok ? response.json() : null),
    ]).then(([thesisResult, discoveryResult, researchResult]) => {
      if (controller.signal.aborted) return;
      const thesis = thesisResult.status === 'fulfilled' ? thesisResult.value as { versions?: Array<{ supersededAt: string | null }> } | null : null;
      const discovery = discoveryResult.status === 'fulfilled' ? discoveryResult.value as { runs?: Array<{ status: string }> } | null : null;
      const research = researchResult.status === 'fulfilled' ? researchResult.value as { analyses?: unknown[] } | null : null;
      const runs = discovery?.runs ?? [];
      setSnapshot({
        hasApprovedStrategy: Boolean(thesis?.versions?.some(version => !version.supersededAt)),
        discoveryState: runs.some(run => ['dispatching', 'queued', 'running'].includes(run.status))
          ? 'working'
          : runs.some(run => run.status === 'completed') ? 'complete' : 'none',
        hasResearch: Boolean(research?.analyses?.length),
      });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [active]);

  const stageStates = useMemo<StageState[]>(() => {
    if (active === -1) return ['next', 'locked', 'locked', 'locked'];
    return steps.map((step, index) => {
      if (step.id === 'strategy' && snapshot.hasApprovedStrategy) return 'complete';
      if (step.id === 'discovery' && snapshot.discoveryState === 'working') return 'working';
      if (step.id === 'discovery' && snapshot.discoveryState === 'complete') return 'complete';
      if (step.id === 'research' && snapshot.hasResearch) return 'complete';
      if (index === active) return 'current';
      if (index < active) return 'complete';
      if (index === active + 1) return 'next';
      return 'locked';
    });
  }, [active, snapshot]);

  if (active === -1) return null;
  const copy = labels[language];

  return <nav className="investment-workflow-nav" aria-label={copy[0]}>
    <ol>{steps.map((step, index) => <li key={step.href} data-stage-state={stageStates[index]}>
      <Link href={step.href} aria-current={active === index ? 'step' : undefined}>
        <span className="workflow-step-number" aria-hidden="true">{stageStates[index] === 'complete' ? '✓' : index + 1}</span>
        <span>{copy[index + 1]}</span>
        <small>{stageLabel(stageStates[index])}</small>
      </Link>
    </li>)}</ol>
  </nav>;
}
