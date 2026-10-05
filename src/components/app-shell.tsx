'use client';

import type { ReactNode } from 'react';
import { PortfolioProvider } from '@/lib/portfolio-context';
import { Header } from './header';
import { InvestmentWorkflowNav } from './investment-workflow-nav';
import { WorkflowNextAction } from './workflow-next-action';
import { ErrorBoundary } from './error-boundary';
import { usePathname } from 'next/navigation';
import { LanguageProvider, useLanguage } from '@/lib/i18n';
import { GoogleCloudTranslateContent } from './google-cloud-translate-content';

function SkipLink() {
  const { t } = useLanguage();
  return <a className="skip-link" href="#workspace-content">{t('nav.skipContent')}</a>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/login' || pathname === '/register') return <>{children}</>;
  return (
    <LanguageProvider>
      <PortfolioProvider>
        <div className="app-shell">
          <div className="ambient-light" aria-hidden="true" />
          <div className="ambient-light ambient-light-secondary" aria-hidden="true" />
          <SkipLink />
          <Header />
          <section className="content" id="workspace-content" tabIndex={-1}>
            <InvestmentWorkflowNav />
            <WorkflowNextAction />
            <ErrorBoundary>{children}</ErrorBoundary>
          </section>
          <GoogleCloudTranslateContent />
        </div>
      </PortfolioProvider>
    </LanguageProvider>
  );
}
