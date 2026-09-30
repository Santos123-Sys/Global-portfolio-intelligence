'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/lib/i18n';

const labels = {
  en: ['Investment workflow', 'Portfolio strategy', 'Discover & review', 'Analysis & valuation', 'Portfolio & risk'],
  pt: ['Fluxo de investimento', 'Estratégia de portfólio', 'Descobrir e revisar', 'Análise e valuation', 'Portfólio e risco'],
  es: ['Proceso de inversión', 'Estrategia de cartera', 'Descubrir y revisar', 'Análisis y valoración', 'Cartera y riesgo'],
  de: ['Anlageprozess', 'Portfoliostrategie', 'Entdecken und prüfen', 'Analyse und Bewertung', 'Portfolio und Risiko'],
};

const steps = [
  { href: '/investment-thesis', matches: ['/investment-thesis'] },
  { href: '/ai-stock-discovery', matches: ['/ai-stock-discovery'] },
  { href: '/research', matches: ['/research', '/security/', '/workspace/'] },
  { href: '/positions', matches: ['/positions', '/allocation', '/risk', '/governance'] },
] as const;

/** Navigation represents the current page, never inferred investment completion. */
export function InvestmentWorkflowNav() {
  const pathname = usePathname();
  const { language } = useLanguage();
  const active = steps.findIndex(step => step.matches.some(path => path.endsWith('/') ? pathname.startsWith(path) : pathname === path));
  if (active === -1) return null;
  const copy = labels[language];
  return <nav className="investment-workflow-nav" aria-label={copy[0]}>
    <ol>{steps.map((step, index) => <li key={step.href}>
      <Link href={step.href} aria-current={active === index ? 'step' : undefined}>
        <span className="workflow-step-number" aria-hidden="true">{index + 1}</span>
        <span>{copy[index + 1]}</span>
      </Link>
    </li>)}</ol>
  </nav>;
}
