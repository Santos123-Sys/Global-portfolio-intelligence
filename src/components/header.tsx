'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { usePortfolioBreadcrumb } from '@/lib/portfolio-context';
import { useLanguage, type TranslationKey } from '@/lib/i18n';

const WORKFLOW_NAV = [
  ['/investment-thesis', 'nav.thesis', 'Mandate'],
  ['/ai-stock-discovery', 'nav.discover', 'Screen'],
  ['/research', 'nav.analysis', 'Research'],
  ['/positions', 'nav.portfolio', 'Portfolio'],
] as const satisfies ReadonlyArray<readonly [string, TranslationKey, string]>;

const REVIEW_NAV = [
  ['/governance', 'nav.investmentControl'],
] as const satisfies ReadonlyArray<readonly [string, TranslationKey]>;

const OPERATIONS_NAV = [
  ['/research-operations', 'nav.researchOperations'],
  ['/agent-settings', 'nav.agentSettings'],
] as const satisfies ReadonlyArray<readonly [string, TranslationKey]>;

const SETTINGS_NAV = [
  ['/account/security', 'nav.accountSecurity'],
] as const satisfies ReadonlyArray<readonly [string, TranslationKey]>;

const PORTFOLIO_PATHS = new Set(['/positions', '/allocation', '/risk', '/governance']);

type AccessibleAccount = { accountId: string; accountName: string; accountType: string; role: string };

function isActive(pathname: string, href: string): boolean {
  if (href === '/positions') return PORTFOLIO_PATHS.has(pathname);
  return pathname === href || (href === '/research' && (pathname.startsWith('/security/') || pathname.startsWith('/workspace/')));
}

function workspaceTitle(pathname: string): { title: string; subtitle: string } {
  if (pathname === '/investment-thesis') return { title: 'Portfolio Strategy', subtitle: 'Define the mandate that governs research' };
  if (pathname === '/ai-stock-discovery') return { title: 'Discovery', subtitle: 'Screen the market against the approved mandate' };
  if (pathname === '/research' || pathname.startsWith('/security/') || pathname.startsWith('/workspace/')) return { title: 'Research', subtitle: 'Review evidence, thesis changes and valuation' };
  if (PORTFOLIO_PATHS.has(pathname)) return { title: 'Portfolio', subtitle: 'Positions, allocation, risk and governance' };
  if (pathname === '/research-operations') return { title: 'Research Operations', subtitle: 'Agent execution, provider health and activity' };
  if (pathname === '/agent-settings') return { title: 'Agent Settings', subtitle: 'Configure research providers and execution' };
  if (pathname.startsWith('/admin')) return { title: 'Administration', subtitle: 'Platform operations and access' };
  return { title: 'Global Portfolio Intelligence', subtitle: 'Evidence-led investment operating system' };
}

function ThemeToggle() {
  const { t } = useLanguage();
  const [theme, setTheme] = useState<'dark' | 'light'>('light');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('theme');
      if (stored === 'light' || stored === 'dark') {
        setTheme(stored);
        document.documentElement.dataset.theme = stored;
      }
    } catch {
      return;
    }
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { window.localStorage.setItem('theme', next); } catch { return; }
  }

  return <button type="button" onClick={toggle} aria-label={t('actions.toggleTheme')}>
    {theme === 'dark' ? t('actions.dark') : t('actions.light')}
  </button>;
}

function LogoutButton() {
  const { t } = useLanguage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logout() {
    setBusy(true);
    setFailed(false);
    const response = await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => null);
    if (!response?.ok) {
      setFailed(true);
      setBusy(false);
      return;
    }
    router.replace('/login');
    router.refresh();
  }

  return <button type="button" onClick={logout} disabled={busy}>
    {busy ? t('actions.signingOut') : failed ? t('actions.retrySignOut') : t('actions.signOut')}
  </button>;
}

function AccountSwitcher() {
  const { t } = useLanguage();
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccessibleAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/accounts')
      .then((response) => response.ok ? response.json() : null)
      .then((data: { accounts?: AccessibleAccount[]; activeAccountId?: string } | null) => {
        if (cancelled || !data) return;
        setAccounts(data.accounts ?? []);
        setActiveAccountId(data.activeAccountId ?? '');
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  if (accounts.length < 2) return null;

  return <label className="account-switcher">
    <span className="sr-only">{t('account.activeClient')}</span>
    <select
      value={activeAccountId}
      disabled={busy}
      onChange={async (event) => {
        const accountId = event.target.value;
        setBusy(true);
        const response = await fetch('/api/accounts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accountId }),
        }).catch(() => null);
        if (response?.ok) {
          setActiveAccountId(accountId);
          router.refresh();
          window.location.reload();
          return;
        }
        setBusy(false);
      }}
    >
      {accounts.map((account) => <option key={account.accountId} value={account.accountId}>{account.accountName}</option>)}
    </select>
  </label>;
}

export function Header() {
  const pathname = usePathname();
  const { viewing } = usePortfolioBreadcrumb();
  const { language, setLanguage, t } = useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const title = workspaceTitle(pathname);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session')
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (!cancelled) setIsPlatformAdmin(Boolean(data?.account?.isPlatformAdmin)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  return <>
    <aside className={`workspace-sidebar${mobileOpen ? ' is-open' : ''}`} aria-label="Workspace navigation">
      <Link href="/" className="brand" aria-label="Global Portfolio Intelligence home">
        <Image src="/brand/portfolio-intelligence-mark.svg" alt="" width={34} height={34} className="brand-logo" priority />
        <span className="brand-copy"><strong>Global Portfolio Intelligence</strong><span>Investment OS</span></span>
      </Link>

      <nav className="workspace-nav" aria-label={t('nav.mainNavigation')}>
        <div className="workspace-nav-group">
          <span className="workspace-nav-label">Investment workflow</span>
          {WORKFLOW_NAV.map(([href, key, stage]) => <Link
            key={href}
            href={href}
            className={`workspace-nav-link${isActive(pathname, href) ? ' active' : ''}`}
            aria-current={isActive(pathname, href) ? 'page' : undefined}
          >
            <span>{t(key)}</span><small>{stage}</small>
          </Link>)}
        </div>

        <div className="workspace-nav-group">
          <span className="workspace-nav-label">Review</span>
          {REVIEW_NAV.map(([href, key]) => <Link key={href} href={href} className={`workspace-nav-link${pathname === href ? ' active' : ''}`}>{t(key)}</Link>)}
        </div>

        <div className="workspace-nav-group">
          <span className="workspace-nav-label">Operations</span>
          {OPERATIONS_NAV.map(([href, key]) => <Link key={href} href={href} className={`workspace-nav-link${pathname === href ? ' active' : ''}`}>{t(key)}</Link>)}
          {isPlatformAdmin && <Link href="/admin" className={`workspace-nav-link${pathname.startsWith('/admin') ? ' active' : ''}`}>{t('nav.adminPanel')}</Link>}
        </div>

        <div className="workspace-nav-group">
          <span className="workspace-nav-label">Account</span>
          {SETTINGS_NAV.map(([href, key]) => <Link key={href} href={href} className={`workspace-nav-link${pathname === href ? ' active' : ''}`}>{t(key)}</Link>)}
        </div>
      </nav>

      <div className="workspace-sidebar-footer">
        <AccountSwitcher />
        <div className="sidebar-control-row">
          <label>
            <span className="sr-only">{t('language.label')}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)} aria-label={t('language.label')}>
              <option value="en">EN</option><option value="pt">PT</option><option value="es">ES</option><option value="de">DE</option>
            </select>
          </label>
          <ThemeToggle />
        </div>
        <LogoutButton />
      </div>
    </aside>

    <header className="workspace-topbar">
      <div className="workspace-topbar-actions">
        <button type="button" className="mobile-nav-toggle" onClick={() => setMobileOpen((open) => !open)} aria-expanded={mobileOpen} aria-label="Toggle workspace navigation">
          <span aria-hidden="true">☰</span><span>Menu</span>
        </button>
        <div className="workspace-topbar-title"><strong>{title.title}</strong><span>{title.subtitle}</span></div>
      </div>
      <div className="workspace-topbar-actions">
        {viewing ? <span className="workspace-context-chip">{viewing.name} · {viewing.currency}</span> : <span className="workspace-context-chip">No portfolio selected</span>}
      </div>
    </header>
  </>;
}
