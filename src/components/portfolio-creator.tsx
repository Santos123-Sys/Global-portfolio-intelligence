'use client';

import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import type { ThesisCriteria } from '@portfolio-intelligence/agentic-contract';
import { useLanguage } from '@/lib/i18n';
import { PortfolioCreatorState, type CreatorSession } from '@/lib/portfolio-creator-state';
import { PortfolioCreatorCore } from './portfolio-creator-core';
import styles from './portfolio-creator.module.css';

type CoreProps = ComponentProps<typeof PortfolioCreatorCore>;

interface ThesisVersionSummary {
  id: string;
  versionNumber: number;
  effectiveDate: string;
  supersededAt: string | null;
  criteriaJson: ThesisCriteria;
}

interface CreatorSnapshot extends CreatorSession {
  stalled?: boolean;
}

export function PortfolioCreator(props: CoreProps) {
  const { language } = useLanguage();
  const pt = language === 'pt';
  const [versions, setVersions] = useState<ThesisVersionSummary[]>([]);
  const [creator, setCreator] = useState<CreatorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [coreKey, setCoreKey] = useState(0);

  const loadHub = useCallback(async () => {
    const [versionsResponse, creatorResponse] = await Promise.all([
      fetch('/api/thesis', { cache: 'no-store' }),
      fetch('/api/thesis/portfolio-creator', { cache: 'no-store' }),
    ]);
    const versionsBody = await versionsResponse.json();
    const creatorBody = await creatorResponse.json();
    if (!versionsResponse.ok) throw new Error(versionsBody.error ?? 'Could not load strategy versions');
    if (!creatorResponse.ok) throw new Error(creatorBody.error ?? 'Could not load Portfolio Creator');
    const parsed = PortfolioCreatorState.safeParse(creatorBody.state);
    if (!parsed.success) throw new Error('Saved Portfolio Creator state is invalid');
    setVersions(Array.isArray(versionsBody.versions) ? versionsBody.versions : []);
    setCreator({ revision: creatorBody.revision, state: parsed.data, stalled: Boolean(creatorBody.stalled) });
    setError('');
  }, []);

  useEffect(() => {
    let active = true;
    void loadHub().catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load Portfolio Creator'); })
      .finally(() => { if (active) setLoading(false); });
    const timer = window.setInterval(() => {
      void loadHub().catch(() => undefined);
    }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [loadHub]);

  const activeVersion = useMemo(() => versions.find(version => !version.supersededAt) ?? null, [versions]);
  const state = creator?.state;
  const answered = state ? Object.keys(state.answers).length : 0;
  const hasCreatorWork = Boolean(state && (answered > 0 || state.messages.length > 0 || state.draft || state.extractionId));
  const versionConflict = Boolean(activeVersion && hasCreatorWork && state?.baseVersionId !== activeVersion.id);
  const profileStatus = state?.profile
    ? (pt ? 'Perfil confirmado' : 'Profile confirmed')
    : `${answered}/11 ${pt ? 'respostas' : 'answers'}`;
  const strategyStatus = state?.phase === 'document_ready'
    ? (pt ? 'Pronta para revisão' : 'Ready for review')
    : state?.draft
      ? (pt ? 'Rascunho em andamento' : 'Draft in progress')
      : activeVersion
        ? `${pt ? 'Ativa' : 'Active'} · v${activeVersion.versionNumber}`
        : (pt ? 'Ainda não criada' : 'Not created yet');

  async function startFromCurrentVersion() {
    if (!creator || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/thesis/portfolio-creator', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'restart_strategy', revision: creator.revision, baseVersionId: activeVersion?.id ?? null }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not start a clean strategy update');
      const parsed = PortfolioCreatorState.parse(body.state);
      setCreator({ revision: body.revision, state: parsed });
      setCoreKey(value => value + 1);
      requestAnimationFrame(() => document.getElementById('portfolio-creator-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start a clean strategy update');
    } finally {
      setBusy(false);
    }
  }

  async function deleteVersion(version: ThesisVersionSummary) {
    const label = `${pt ? 'versão' : 'version'} ${version.versionNumber}`;
    const confirmed = window.confirm(pt
      ? `Excluir ${label}? Ela sairá das telas ativas, mas referências históricas de auditoria serão preservadas.`
      : `Delete ${label}? It will be removed from active strategy views, while historical audit references are preserved.`);
    if (!confirmed || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/thesis?id=${encodeURIComponent(version.id)}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `Could not delete ${label}`);
      await loadHub();
      setCoreKey(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not delete ${label}`);
    } finally {
      setBusy(false);
    }
  }

  const core = <PortfolioCreatorCore key={coreKey} {...props} />;

  return <section className={styles.shell} aria-labelledby="portfolio-creator-assistant-title">
    <header className={styles.hero}>
      <div className={styles.avatar} aria-hidden="true">✦</div>
      <div>
        <h2 id="portfolio-creator-assistant-title" translate="no">Portfolio Creator</h2>
        <p>{pt ? 'Seu atalho para criar, revisar e atualizar a estratégia.' : 'Your shortcut to create, review and update the strategy.'}</p>
      </div>
    </header>

    <div className={styles.body}>
      <div className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <span>{pt ? 'Perfil do investidor' : 'Investor profile'}</span>
          <strong>{profileStatus}</strong>
          <small>{state?.profile ? (pt ? 'Usado como restrição obrigatória da estratégia.' : 'Used as a mandatory strategy constraint.') : (pt ? 'Complete o perfil antes de gerar a estratégia.' : 'Complete the profile before strategy generation.')}</small>
        </article>
        <article className={styles.summaryCard} id="portfolio-creator-current">
          <span>{pt ? 'Estratégia' : 'Strategy'}</span>
          <strong>{strategyStatus}</strong>
          <small>{activeVersion ? `${pt ? 'Aprovada em' : 'Approved'} ${new Date(activeVersion.effectiveDate).toLocaleDateString()}` : (pt ? 'Nenhuma versão aprovada.' : 'No approved version yet.')}</small>
        </article>
      </div>

      <nav className={styles.actions} aria-label={pt ? 'Atalhos do Portfolio Creator' : 'Portfolio Creator shortcuts'}>
        <button type="button" className={styles.action} onClick={() => void startFromCurrentVersion()} disabled={busy || loading}>
          + {activeVersion ? (pt ? 'Atualizar estratégia' : 'Update strategy') : (pt ? 'Criar estratégia' : 'Create strategy')}
        </button>
        <a className={styles.action} href="#portfolio-creator-current">▦ {pt ? 'Revisar estratégia' : 'Review strategy'}</a>
        <a className={styles.action} href="#portfolio-creator-versions">↗ {pt ? 'Ver versões' : 'See versions'}</a>
      </nav>

      <p className={styles.prompt}>{pt
        ? 'Diga o que deseja mudar, continue seu perfil ou revise a estratégia atual. O Portfolio Creator sempre parte da versão ativa e pede confirmação antes de substituir qualquer versão aprovada.'
        : 'Tell me what you want to change, continue your profile, or review the current strategy. Portfolio Creator always starts from the active version and asks before replacing an approved version.'}</p>

      {loading && <p className={styles.loading} role="status">{pt ? 'Carregando o Portfolio Creator…' : 'Loading Portfolio Creator…'}</p>}
      {error && <div className="caveat" role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={() => void loadHub()}>{pt ? 'Tentar novamente' : 'Retry'}</button></div>}

      {versionConflict ? <section className={styles.conflict} role="alert">
        <h3>{pt ? 'A conversa salva pertence a uma versão anterior' : 'The saved conversation belongs to an older strategy version'}</h3>
        <p>{pt
          ? `A estratégia ativa agora é v${activeVersion?.versionNumber}. Para evitar misturar versões, inicie uma atualização limpa. Seu perfil confirmado será preservado.`
          : `The active strategy is now v${activeVersion?.versionNumber}. To avoid mixing versions, start a clean update. Your confirmed investor profile will be preserved.`}</p>
        <button type="button" className="action-button" disabled={busy} onClick={() => void startFromCurrentVersion()}>{pt ? 'Atualizar a partir da versão ativa' : 'Update from active version'}</button>
      </section> : <div className={styles.workspace} id="portfolio-creator-workspace">{core}</div>}

      <details className={styles.versions} id="portfolio-creator-versions">
        <summary>{pt ? `Gerenciar versões (${versions.length})` : `Manage versions (${versions.length})`}</summary>
        <p className="note">{pt
          ? 'Excluir remove a versão das telas ativas, mas mantém referências históricas necessárias para auditoria e decisões anteriores.'
          : 'Delete removes a version from active strategy views while retaining historical references required for audit and prior decisions.'}</p>
        <div className={styles.versionList}>
          {versions.length === 0 && <p className="note">{pt ? 'Nenhuma versão aprovada.' : 'No approved versions.'}</p>}
          {versions.map(version => <div className={styles.versionRow} key={version.id}>
            <div className={styles.versionMeta}>
              <strong>{pt ? 'Versão' : 'Version'} {version.versionNumber}{!version.supersededAt ? ` · ${pt ? 'Ativa' : 'Active'}` : ''}</strong>
              <span>{new Date(version.effectiveDate).toLocaleString()}</span>
            </div>
            <button type="button" className={styles.dangerAction} disabled={busy} onClick={() => void deleteVersion(version)}>{pt ? 'Excluir versão' : 'Delete version'}</button>
          </div>)}
        </div>
      </details>
    </div>
  </section>;
}
