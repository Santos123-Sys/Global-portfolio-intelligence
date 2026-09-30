'use client';

import type { ReactNode } from 'react';
import { PortfolioProvider } from '@/lib/portfolio-context';
import { Header } from './header';
import { ErrorBoundary } from './error-boundary';
import { usePathname } from 'next/navigation';
import { LanguageProvider, useLanguage } from '@/lib/i18n';

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
            <ErrorBoundary>{children}</ErrorBoundary>
          </section>
        </div>
      </PortfolioProvider>
    </LanguageProvider>
  );
}
