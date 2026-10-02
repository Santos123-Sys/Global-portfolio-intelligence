'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ThesisCriteria, diffThesis, type ThesisExtractionResult } from '@portfolio-intelligence/agentic-contract';
import { ThesisDraft } from '@/lib/thesis-draft';
import { assessThesisReview } from '@/lib/thesis-review';
import { ThesisDiscoveryPreview } from '@/components/thesis-discovery-preview';
import { ThesisCriteriaEditor } from '@/components/thesis-criteria-editor';
import { GovernancePolicyEditor } from '@/components/governance-policy-editor';
import { isCreatorExtraction } from '@/lib/portfolio-creator-state';
import { InvestorProfileSummary } from '@/components/investor-profile-summary';
import type { InvestorProfileSnapshot } from '@/lib/investor-profile';
import { PortfolioCreator } from '@/components/portfolio-creator';
import { canDismissThesisExtraction } from '@/lib/thesis-extraction-lifecycle';

interface ThesisVersionRow {
  id: string;
  versionNumber: number;
  criteriaJson: unknown;
  investorProfileJson?: InvestorProfileSnapshot | null;
  effectiveDate: string;
  supersededAt: string | null;
}

function downloadThesisVersion(thesis: ThesisVersionRow) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ thesisVersionId: thesis.id, effectiveDate: thesis.effectiveDate, investorProfile: thesis.investorProfileJson ?? null, criteria: thesis.criteriaJson }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `thesis-version-${thesis.versionNumber}.json`; link.click(); URL.revokeObjectURL(url);
}

interface ExtractionRow {
  id: string;
  externalExtractionId: string;
  status: string;
  requestedVersion: number;
  sourceFileName: string;
  resultJson: ThesisExtractionResult | null;
  investorProfileJson?: InvestorProfileSnapshot | null;
  errorMessage: string | null;
  requestedAt: string;
  confirmedAt: string | null;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read the selected document'));
    reader.onload = () => {
      const value = String(reader.result);
      const comma = value.indexOf(',');
      if (comma === -1) reject(new Error('Unable to encode the selected document'));
      else resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export default function InvestmentThesisPage() {
  const router = useRouter();
  const [versions, setVersions] = useState<ThesisVersionRow[]>([]);
  const [extractions, setExtractions] = useState<ExtractionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [criteriaDraft, setCriteriaDraft] = useState<ThesisCriteria | null>(null);
  const [baseVersionId, setBaseVersionId] = useState<string | null>(null);
  const [nextVersion, setNextVersion] = useState(1);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState('Edits are not yet saved');
  const [loading, setLoading] = useState(true);
  const restored = useRef(false);
  const confirming = useRef(false);
  const [busy, setBusy] = useState(false);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [transitionNotice, setTransitionNotice] = useState<string | null>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const pendingExtractionIds = extractions
    .filter((item) => item.status === 'queued' || item.status === 'running')
    .map((item) => item.externalExtractionId)
    .sort()
    .join('|');

  const load = useCallback(async (signal?: AbortSignal) => {
    const [versionsResponse, extractionsResponse] = await Promise.all([
      fetch('/api/thesis', { signal }),
      fetch('/api/integrations/agentic/thesis-extractions', { signal }),
    ]);
    if (!versionsResponse.ok || !extractionsResponse.ok) throw new Error('Unable to load thesis workflow');
    const versionsBody = await versionsResponse.json() as { versions: ThesisVersionRow[]; nextVersion?: number; ownerId?: string };
    const extractionsBody = await extractionsResponse.json() as { extractions: ExtractionRow[] };
    if (!signal?.aborted) {
      setVersions(versionsBody.versions);
      setNextVersion(versionsBody.nextVersion ?? Math.max(0, ...versionsBody.versions.map(v=>v.versionNumber))+1);
      setOwnerId(versionsBody.ownerId ?? null);
      setLoading(false); setError(null);
      setExtractions(extractionsBody.extractions);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause) => {
      if (!controller.signal.aborted) { setError((cause as Error).message); setLoading(false); }
    });
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const refreshAfterHistoryRestore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      void load().catch((cause) => setError((cause as Error).message));
    };
    window.addEventListener('pageshow', refreshAfterHistoryRestore);
    return () => window.removeEventListener('pageshow', refreshAfterHistoryRestore);
  }, [load]);

  useEffect(() => {
    if (!pendingExtractionIds) { setRefreshError(null); return; }
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const pendingIds = pendingExtractionIds.split('|');
    async function refresh() {
      try {
        const refreshed = await Promise.all(pendingIds.map(async externalExtractionId => {
          const response = await fetch(`/api/integrations/agentic/thesis-extractions?externalExtractionId=${encodeURIComponent(externalExtractionId)}`, { signal: controller.signal, cache: 'no-store' });
          if (!response.ok) throw new Error('Extraction status is unavailable');
          const body = await response.json() as { extraction: ExtractionRow; remoteError?: string };
          if (body.remoteError) throw new Error(body.remoteError);
          return body.extraction;
        }));
        if (!controller.signal.aborted) {
          setExtractions(current => current.map(item => refreshed.find(candidate => candidate.externalExtractionId === item.externalExtractionId) ?? item));
          setRefreshError(null);
        }
      } catch { if (!controller.signal.aborted) setRefreshError('Live extraction status could not refresh. Saved results remain visible; automatic refresh will retry.'); }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 3000); }
    }
    timer = setTimeout(() => void refresh(), 3000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pendingExtractionIds]);

  useEffect(() => {
    if (!ownerId || restored.current) return;
    restored.current = true;
    try {
      const raw = sessionStorage.getItem(`thesis-draft:${ownerId}`);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const parsed = ThesisDraft.safeParse(saved);
      if (!parsed.success) { setSaveStatus('Saved draft is invalid; start a fresh draft.'); return; }
      if (saved.manual) {
        sessionStorage.removeItem(`thesis-draft:${ownerId}`);
        setTransitionNotice('This draft has no source document to verify. Upload a strategy document to create a new review.');
        return;
      }
      setCriteriaDraft(parsed.data.criteria); setSelectedId(parsed.data.selectedId);
      setBaseVersionId(saved.baseVersionId ?? null);
      setReviewNotes(typeof saved.reviewNotes === 'string' ? saved.reviewNotes : '');
      setSaveStatus('Recovered draft from this browser tab');
    } catch { setSaveStatus('Draft recovery is unavailable in this browser. Keep this page open.'); }
  }, [ownerId]);

  useEffect(() => {
    if (!ownerId || !criteriaDraft || !restored.current) return;
    try {
      sessionStorage.setItem(`thesis-draft:${ownerId}`, JSON.stringify({ schemaVersion: 1, manual: false, criteria: criteriaDraft, selectedId, baseVersionId, reviewNotes }));
      setSaveStatus('Draft saved in this browser tab — not yet approved');
    } catch { setSaveStatus('Draft could not be saved in this browser. Keep this page open and approve when ready.'); }
  }, [ownerId, criteriaDraft, selectedId, baseVersionId, reviewNotes]);

  useEffect(() => {
    if (!criteriaDraft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [criteriaDraft]);

  const activeThesis = versions.find(version => !version.supersededAt) ?? null;
  const pendingReviews = extractions.filter(item => !item.confirmedAt);
  const historicalVersions = versions.filter(version => version.supersededAt);

  const draftReview = criteriaDraft ? assessThesisReview(criteriaDraft) : null;
  const staleDraft = !!criteriaDraft && (criteriaDraft.version !== nextVersion || baseVersionId !== (versions.find(v=>!v.supersededAt)?.id ?? null));
  const selected = extractions.find((item) => item.id === selectedId) ?? null;
  const hasDraft = criteriaDraft !== null;

  useEffect(() => {
    if (!selected?.confirmedAt || !criteriaDraft) return;
    setSelectedId(null);
    setCriteriaDraft(null);
    setBaseVersionId(null);
    setReviewNotes('');
    if (ownerId) {
      try { sessionStorage.removeItem(`thesis-draft:${ownerId}`); }
      catch { setError('The approved browser draft could not be cleared. Refresh this page before editing another strategy.'); }
    }
    setSaveStatus('Approved draft cleared from this browser tab');
    setTransitionNotice('This draft was already approved. The current approved strategy is shown above.');
  }, [selected?.confirmedAt, selected?.id, criteriaDraft, ownerId]);

  useEffect(() => {
    if (selected?.status === 'completed' && selected.resultJson && !criteriaDraft) {
      setCriteriaDraft(structuredClone(selected.resultJson.criteria));
    }
  }, [selected, criteriaDraft]);

  useEffect(() => {
    if (hasDraft) {
      reviewRef.current?.focus({ preventScroll: true });
      reviewRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }, [selectedId, hasDraft]);

  async function upload(file: File | null) {
    if (!file) return;
    if (criteriaDraft && !window.confirm('Replace the current unapproved draft with this document?')) return;
    setBusy(true); setDocumentBusy(true);
    setError(null);
    try {
      const mimeType = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
        ? 'application/pdf'
        : file.name.toLowerCase().endsWith('.md') ? 'text/markdown' : 'text/plain';
      const maxBytes = mimeType === 'application/pdf' ? 10 * 1024 * 1024 : 2 * 1024 * 1024;
      if (file.size < 1 || file.size > maxBytes) {
        throw new Error(mimeType === 'application/pdf'
          ? 'PDF documents must contain data and be no larger than 10 MB'
          : 'Text documents must contain data and be no larger than 2 MB');
      }
      const response = await fetch('/api/integrations/agentic/thesis-extractions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, mimeType, contentBase64: await fileToBase64(file) }),
      });
      const body = await response.json().catch(() => ({})) as { extraction?: ExtractionRow; error?: string };
      if (!response.ok || !body.extraction) throw new Error(body.error ?? `Upload failed (${response.status})`);
      setBaseVersionId(versions.find(v=>!v.supersededAt)?.id ?? null);
      setExtractions((current) => [body.extraction!, ...current]);
      setSelectedId(body.extraction.id);
      setCriteriaDraft(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false); setDocumentBusy(false);
    }
  }

  function review(extraction: ExtractionRow) {
    if (criteriaDraft && !window.confirm('Replace the current unapproved draft?')) return;
    setBaseVersionId(versions.find(v=>!v.supersededAt)?.id ?? null);
    setReviewNotes('');
    setSelectedId(extraction.id);
    setCriteriaDraft(extraction.resultJson ? structuredClone(extraction.resultJson.criteria) : null);
    setError(null);
  }

  async function confirm(startDiscovery = true) {
    if (!selected || confirming.current) return;
    confirming.current = true;
    setBusy(true);
    setError(null);
    setTransitionNotice(null);
    try {
      if (!criteriaDraft) throw new Error('No extracted criteria are available to confirm');
      const response = await fetch('/api/thesis', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ externalExtractionId: selected?.externalExtractionId, criteriaJson: draftReview?.criteria, reviewNotes, baseVersionId, startDiscovery }),
      });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        discoveryTransition?: {
          status: 'started' | 'existing' | 'blocked' | 'not_requested';
          runId?: string;
          runStatus?: string;
          errorMessage?: string;
        };
      };
      if (!response.ok) {
        if (response.status === 409) await load();
        throw new Error(body.error ?? `Confirmation failed (${response.status})`);
      }
      setSelectedId(null);
      setCriteriaDraft(null);
      if (ownerId) { try { sessionStorage.removeItem(`thesis-draft:${ownerId}`); } catch {} }
      if (body.discoveryTransition?.status === 'started' || body.discoveryTransition?.status === 'existing') {
        router.push('/ai-stock-discovery');
      } else if (body.discoveryTransition?.status === 'not_requested') {
        setTransitionNotice('Strategy approved. Open Discovery when you are ready to search using this version.');
        await load();
      } else {
        setTransitionNotice(
          `The strategy was approved, but market research did not start: ${body.discoveryTransition?.errorMessage ?? 'the transition was not accepted'}. ` +
          'Correct the stated prerequisite, then use “Find thesis-matched stocks” on the discovery page.'
        );
        await load();
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false); confirming.current = false;
    }
  }

  async function retry(extraction: ExtractionRow) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/integrations/agentic/thesis-extractions?externalExtractionId=${encodeURIComponent(extraction.externalExtractionId)}`, {
        method: 'PATCH',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Retry failed (${response.status})`);
      }
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(extraction: ExtractionRow) {
    const dismissalNotice = extraction.confirmedAt
      ? 'The linked confirmed thesis version and extracted result will also be excluded.'
      : extraction.status === 'queued' || extraction.status === 'running'
        ? 'This does not cancel work already accepted by the agentic service, but its result will remain excluded from this dashboard.'
        : 'Its extracted criteria will not become canonical.';
    if (!window.confirm(`Dismiss ${extraction.sourceFileName} from the review queue? ${dismissalNotice}`)) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/integrations/agentic/thesis-extractions?id=${encodeURIComponent(extraction.id)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Dismissal failed (${response.status})`);
      }
      if (selectedId === extraction.id) {
        setSelectedId(null); setCriteriaDraft(null);
        if (ownerId) { try { sessionStorage.removeItem(`thesis-draft:${ownerId}`); } catch {} }
      }
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function excludeVersion(thesis: ThesisVersionRow) {
    const confirmed = window.confirm(
      `Exclude thesis version ${thesis.versionNumber}? It and its linked extraction data will disappear from active views. ` +
      'Historical audit references will remain. If this is the active version, the latest remaining confirmed version will become active.'
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/thesis?id=${encodeURIComponent(thesis.id)}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Thesis exclusion failed (${response.status})`);
      }
      setSelectedId(null); setCriteriaDraft(null);
      if (ownerId) { try { sessionStorage.removeItem(`thesis-draft:${ownerId}`); } catch {} }
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="portfolio-strategy-page">
      <h1 className="text-glow">Portfolio Strategy</h1>
      <p className="sub">Assess your investor profile with Portfolio Creator, then describe your goals and constraints. Review the strategy PDF and structured mandate before research begins.</p>

      {error && <div className="caveat" role="alert"><p>{error}</p><button type="button" className="secondary-button" disabled={busy} onClick={() => void load().catch(cause => setError(cause.message))}>Retry loading</button></div>}
      {refreshError && <p className="caveat" role="status">{refreshError}</p>}
      {transitionNotice && <p className="caveat" role="status">{transitionNotice}</p>}

      {(!activeThesis || selected) && <ol className="thesis-process" aria-label="Strategy approval steps">
        <li aria-current={!selected ? 'step' : undefined}><span>1</span> Assess profile and define constraints</li>
        <li aria-current={selected && ['queued', 'running'].includes(selected.status) ? 'step' : undefined}><span>2</span> Generate and review the PDF</li>
        <li aria-current={criteriaDraft ? 'step' : undefined}><span>3</span> Review and approve</li>
      </ol>}
      {!loading && activeThesis && <section className="card thesis-active" aria-labelledby="active-thesis-title">
        <div className="section-heading"><div><p className="analysis-eyebrow">Current strategy</p><h2 id="active-thesis-title">Approved portfolio strategy</h2></div><span className="badge ok">Active · v{activeThesis.versionNumber}</span></div>
        {activeThesis.investorProfileJson && <InvestorProfileSummary profile={activeThesis.investorProfileJson} />}
        <p className="note">Approved: {new Date(activeThesis.effectiveDate).toLocaleDateString()}</p><div className="thesis-destination-list">{(activeThesis.criteriaJson as ThesisCriteria).portfolios.map((portfolio, index) => <article key={`${portfolio.role}-${index}`}>
          <strong>{portfolio.policy?.name || roleLabel(portfolio.role)}</strong><span className="badge">{portfolio.currency}</span><p>{portfolio.objective}</p>
        </article>)}</div>
        <div className="workflow-actions"><Link className="action-button inline-action" href="/ai-stock-discovery">Continue to Discovery</Link><a className="secondary-button" href={`/api/thesis/pdf?versionId=${encodeURIComponent(activeThesis.id)}`}>Download strategy PDF</a></div>
        <details><summary>Approved criteria and management</summary><ThesisSummary criteria={activeThesis.criteriaJson as ThesisCriteria} /><ThesisDiscoveryPreview criteria={activeThesis.criteriaJson as ThesisCriteria} /><button className="secondary-button" type="button" onClick={() => downloadThesisVersion(activeThesis)}>Download approved criteria (JSON)</button><button className="secondary-button dismiss-button" type="button" disabled={busy} onClick={() => void excludeVersion(activeThesis)}>Exclude version {activeThesis.versionNumber}</button></details>
      </section>}
      {!loading && criteriaDraft && !selected && <section className="card" role="alert"><h2>Saved review source is unavailable</h2><p>The browser retained edits, but the source is outside the current review queue or was removed. Approval is blocked. Return to Portfolio Creator to reopen its saved review or import the source again.</p><button className="secondary-button" type="button" onClick={() => {
        setCriteriaDraft(null); setSelectedId(null); setBaseVersionId(null); setReviewNotes('');
        if (ownerId) { try { sessionStorage.removeItem(`thesis-draft:${ownerId}`); } catch { setError('Draft recovery could not be cleared from this browser tab.'); } }
      }}>Return to saved interview</button></section>}
      {loading && <p role="status">Loading your thesis workspace…</p>}
      {!loading && !selected && !criteriaDraft && <PortfolioCreator
        key={activeThesis?.id ?? 'new-thesis'}
        nextVersion={nextVersion}
        startingCriteria={activeThesis?.criteriaJson as ThesisCriteria | undefined}
        onGenerated={(extraction) => {
          setExtractions((current) => [extraction, ...current.filter((item) => item.id !== extraction.id)]);
          setBaseVersionId(activeThesis?.id ?? null);
          setSelectedId(extraction.id);
          setCriteriaDraft(null);
          setReviewNotes('');
          setTransitionNotice('Portfolio Creator created a strategy PDF and a structured draft. Review the criteria below; Discovery starts only after you approve.');
        }}
      />}
      <details className="card thesis-upload strategy-entry-card">
        <summary>{documentBusy ? 'Importing strategy document…' : 'Import an existing strategy document (optional)'}</summary>
        <p className="note">If you already have a written mandate, import a PDF, text or Markdown file. The document extraction workflow remains available; Portfolio Creator is the recommended way to create or update a strategy.</p>
        <label className="thesis-file-label">
          Choose strategy document
          <input type="file" accept="application/pdf,text/plain,text/markdown,.pdf,.md,.txt" aria-label="Choose strategy document" disabled={busy || loading} onChange={(event) => { const file = event.target.files?.[0] ?? null; event.target.value = ''; void upload(file); }} />
        </label>
      </details>

      {selected && !criteriaDraft && <section className="card thesis-extraction-status" aria-live="polite">
        <h2>{selected.status === 'failed' ? 'Strategy document needs attention' : 'Reading your strategy'}</h2><p>{selected.sourceFileName}</p>
        <p className="note">{selected.status === 'failed' ? selected.errorMessage ?? 'Extraction failed. Retry this document or choose another.' : 'You can leave this page. The document remains in your review queue; nothing is approved automatically.'}</p>
        <span className={`badge ${selected.status === 'failed' ? 'breach' : 'watch'}`}>{selected.status === 'queued' ? 'Waiting for extraction' : selected.status === 'running' ? 'Reading the document' : selected.status}</span>
        {selected.status === 'failed' && <button className="action-button" type="button" disabled={busy} onClick={() => void retry(selected)}>Retry extraction</button>}
      </section>}
      {selected?.resultJson && (
        <section className="card thesis-review-panel strategy-review-card" id="thesis-review" ref={reviewRef} tabIndex={-1} aria-labelledby="thesis-review-title">
          <p className="analysis-eyebrow">{selected.sourceFileName}</p><h2 id="thesis-review-title">Review portfolio strategy</h2>
          <p role="status">{ownerId ? saveStatus : 'Draft is in memory; keep this page open until approval.'}</p>
          <fieldset disabled={busy} className="thesis-review-fields">
          {staleDraft && <div role="alert" className="caveat">
            <p>{isCreatorExtraction(selected.externalExtractionId)
              ? 'The approved strategy changed while this Portfolio Creator draft was open. Return to Portfolio Creator and update from the active version before approval.'
              : 'The approved strategy changed while this document was being reviewed. Review a fresh extraction against the latest active strategy before approval.'}</p>
            <button type="button" className="secondary-button" onClick={() => {
              setCriteriaDraft(null); setSelectedId(null); setBaseVersionId(null); setReviewNotes('');
              if (ownerId) { try { sessionStorage.removeItem(`thesis-draft:${ownerId}`); } catch { setError('Draft recovery could not be cleared from this browser tab.'); } }
              setTransitionNotice(isCreatorExtraction(selected.externalExtractionId)
                ? 'The stale draft was closed. Portfolio Creator is ready to update from the current approved strategy.'
                : 'The stale draft was closed. Review or import a fresh source against the current approved strategy.');
            }}>{isCreatorExtraction(selected.externalExtractionId) ? 'Return to Portfolio Creator' : 'Close stale review'}</button>
          </div>}

          {selected?.investorProfileJson && <InvestorProfileSummary profile={selected.investorProfileJson} />}
          {selected?.resultJson && (isCreatorExtraction(selected.externalExtractionId)
            ? <p className="note">Portfolio Creator drafted this strategy from your conversation; no external issuer research has been performed. Verify every field below before approval.</p>
            : <p className="note">Extraction confidence: {(selected.resultJson.extractionConfidence * 100).toFixed(0)}%. Check the details below against your source document.</p>)}
          {!!selected?.resultJson?.ambiguousPoints.length && (
            <div className="caveat">
              <strong>Ambiguities requiring judgment</strong>
              <ul>{selected.resultJson.ambiguousPoints.map((point, index) => (
                <li key={`${point.location}-${index}`}>{point.location}: {point.issue} — “{point.sourceExcerpt}”</li>
              ))}</ul>
            </div>
          )}
          {!!selected?.resultJson?.unmappedContent.length && (
            <p className="note">Unmapped content: {selected.resultJson.unmappedContent.join(' · ')}</p>
          )}
          {selected?.resultJson && <details><summary>Compare with the original extraction</summary><ThesisSummary criteria={selected.resultJson.criteria} /></details>}
          {criteriaDraft && <ThesisCriteriaEditor criteria={criteriaDraft} onChange={setCriteriaDraft} />}
          {draftReview && <div aria-live="polite">
            {draftReview.errors.length > 0 && <div className="workflow-error"><strong>Correct before confirmation</strong><ul>{draftReview.errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
            {draftReview.warnings.length > 0 && <details><summary>Review considerations ({draftReview.warnings.length})</summary><ul>{draftReview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
          </div>}
          {draftReview && <>
            <p className={draftReview.errors.length ? 'caveat' : 'badge ok'} role="status">{draftReview.errors.length ? `${draftReview.errors.length} item${draftReview.errors.length === 1 ? '' : 's'} need correction before approval` : 'Ready for your approval'}</p>
            {!!draftReview.issues.length && <details><summary>Ambiguities requiring judgment and observations ({draftReview.issues.length})</summary>{draftReview.issues.map((issue,i)=><article key={i}><p><strong>{issue.severity} · {issue.location}</strong> — “{issue.statement}”</p><p>{issue.reason}</p><p><strong>Interpretation:</strong> {issue.interpretation}</p>{issue.proxy&&<p><strong>Possible proxy:</strong> {issue.proxy}</p>}</article>)}</details>}
            <details><summary>Preview research coverage</summary><ThesisDiscoveryPreview criteria={draftReview.criteria}/></details>
            {versions.find(v=>!v.supersededAt) && <details><summary>Changes from the active version — Discovery should be rerun after material changes</summary><ul>{diffThesis(versions.find(v=>!v.supersededAt)!.criteriaJson as ThesisCriteria,draftReview.criteria).map(change=><li key={change.path}>{change.kind}: {change.path.replace(/([A-Z])/g,' $1')} — {change.previous??'not set'} → {change.current??'removed'}</li>)}</ul><p>Historical runs retain their original thesis; their candidates have not been certified against this draft.</p></details>}
          </>}
          {(draftReview?.needsAcknowledgment || selected?.resultJson?.ambiguousPoints.length || selected?.resultJson?.unmappedContent.length) ? <label className="setup-form">Review note (required)
            <textarea value={reviewNotes} maxLength={4000} onChange={event => setReviewNotes(event.target.value)} placeholder="Briefly explain how you resolved the items above." />
          </label> : null}
          <button className="action-button" type="button" onClick={() => void confirm()} disabled={busy || staleDraft || !criteriaDraft || !!draftReview?.errors.length || (!!(draftReview?.needsAcknowledgment || selected?.resultJson?.ambiguousPoints.length || selected?.resultJson?.unmappedContent.length) && reviewNotes.trim().length < 20) || !!selected?.confirmedAt}>
            Approve strategy and start research
          </button>
          <button type="button" className="secondary-button" onClick={()=>void confirm(false)} disabled={busy || staleDraft || !criteriaDraft || !!draftReview?.errors.length || (!!(draftReview?.needsAcknowledgment || selected?.resultJson?.ambiguousPoints.length || selected?.resultJson?.unmappedContent.length) && reviewNotes.trim().length<20) || !!selected?.confirmedAt}>Approve without starting research</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={()=>{
            if (!window.confirm('Discard this unapproved draft? Approved versions are preserved.')) return;
            setCriteriaDraft(null); setSelectedId(null); setReviewNotes('');
            if (ownerId) { try { sessionStorage.removeItem(`thesis-draft:${ownerId}`); } catch { setError('Draft recovery could not be cleared from this browser tab.'); } }
          }}>Discard unapproved draft</button>
          </fieldset>
        </section>
      )}

      <details className="card" open={pendingReviews.length > 0 && !criteriaDraft}>
        <summary>Documents awaiting review ({pendingReviews.length})</summary>
        <h2>Documents awaiting review</h2>
        {pendingReviews.length === 0 ? <p className="note">No documents awaiting review.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Document</th><th>Version</th><th>Status</th><th>Submitted</th><th>Action</th></tr></thead>
              <tbody>{pendingReviews.map((extraction) => (
                <tr key={extraction.id}>
                  <td>{extraction.sourceFileName}</td>
                  <td>v{extraction.requestedVersion}</td>
                  <td><span className={`badge ${extraction.status === 'failed' ? 'breach' : extraction.status === 'completed' ? 'ok' : 'watch'}`}>{extraction.status}</span></td>
                  <td>{new Date(extraction.requestedAt).toLocaleString()}</td>
                  <td>
                    <div className="thesis-extraction-actions">
                      {extraction.status === 'completed' && !extraction.confirmedAt && (
                        <button className="action-button" type="button" disabled={busy} onClick={() => review(extraction)}>Review</button>
                      )}
                      {extraction.status === 'failed' && (
                        <button className="action-button" type="button" onClick={() => void retry(extraction)} disabled={busy}>Retry</button>
                      )}
                      {extraction.confirmedAt && <span className="note">Confirmed</span>}
                      <button
                        className="action-button dismiss-button"
                        type="button"
                        onClick={() => void dismiss(extraction)}
                        disabled={busy || !canDismissThesisExtraction(extraction.status)}
                        title="Hide this record from the review queue"
                        aria-label={`Dismiss ${extraction.sourceFileName} from the review queue`}
                      >
                        Dismiss
                      </button>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </details>

      <details className="card">
        <summary>Previous approved versions ({historicalVersions.length})</summary>
        <h2>Version history</h2>
        {historicalVersions.length === 0 ? <p className="note">No previous approved versions.</p> : (
          <div className="grid">{historicalVersions.map((thesis) => (
            <article className="card" key={thesis.id}>
              <h3>Version {thesis.versionNumber}</h3>
              <p className="note">Effective: {new Date(thesis.effectiveDate).toLocaleString()}</p>
              <span className={`badge ${thesis.supersededAt ? 'watch' : 'ok'}`}>{thesis.supersededAt ? 'Superseded' : 'Active'}</span>
              <button
                className="action-button dismiss-button"
                type="button"
                onClick={() => void excludeVersion(thesis)}
                disabled={busy}
                aria-label={`Exclude thesis version ${thesis.versionNumber}`}
              >
                Exclude version
              </button>
              <details><summary>Advanced export</summary><a className="secondary-button" href={`/api/thesis/pdf?versionId=${encodeURIComponent(thesis.id)}`}>Download strategy PDF</a><button type="button" className="secondary-button" onClick={() => downloadThesisVersion(thesis)}>Download confirmed criteria (JSON)</button></details>
              <ThesisSummary criteria={thesis.criteriaJson as ThesisCriteria} />
              <ThesisDiscoveryPreview criteria={thesis.criteriaJson as ThesisCriteria} />
            </article>
          ))}</div>
        )}
      </details>

      <details className="card"><summary>Approved source documents ({extractions.filter(item => item.confirmedAt).length})</summary>
        {extractions.filter(item => item.confirmedAt).map(extraction => <article className="thesis-mandate" key={extraction.id}>
          <h3>{extraction.sourceFileName}</h3><p className="note">Approved · v{extraction.requestedVersion}</p>
          {extraction.resultJson && <details><summary>{isCreatorExtraction(extraction.externalExtractionId) ? 'Generated mandate' : 'Original extraction and evidence'}</summary><ThesisSummary criteria={extraction.resultJson.criteria} />{!isCreatorExtraction(extraction.externalExtractionId) && <><p>Extraction confidence: {(extraction.resultJson.extractionConfidence * 100).toFixed(0)}%</p><ul>{extraction.resultJson.ambiguousPoints.map((point, index) => <li key={index}>{point.location}: {point.issue} — “{point.sourceExcerpt}”</li>)}</ul><p>{extraction.resultJson.unmappedContent.join(' · ')}</p></>}</details>}
          <button className="secondary-button dismiss-button" type="button" disabled={busy || !canDismissThesisExtraction(extraction.status)} onClick={() => void dismiss(extraction)} aria-label={`Dismiss ${extraction.sourceFileName} from the review queue`}>Dismiss document and linked thesis</button>
        </article>)}
      </details>
      <details className="card" id="portfolio-guardrails">
        <summary>Optional portfolio monitoring guardrails</summary>
        <h2>Monitoring guardrails</h2>
        <p className="note">Set review prompts for portfolio concentration and evidence freshness after defining the mandate. These settings are optional: they do not block thesis approval, Discovery, analysis, or valuation, and they never submit trades.</p>
        <GovernancePolicyEditor />
      </details>
    </main>
  );
}

function roleLabel(role: string): string {
  return role.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ThesisSummary({
  criteria,
}: {
  criteria: ThesisCriteria;
}) {
  return (
    <div className="thesis-summary" aria-label="Portfolio strategy criteria summary">
      {criteria.portfolios.map((portfolio, index) => (
        <article className="thesis-mandate" key={`${portfolio.role}-${index}`}>
          <div className="thesis-mandate-heading">
            <h3>{roleLabel(portfolio.role)}</h3>
            <span className="badge watch">{portfolio.currency}</span>
          </div>
          <p><strong>Objective</strong><br />{portfolio.objective}</p>
          <div className="thesis-summary-columns">
            <div><strong>What qualifies</strong>{portfolio.inclusionCriteria.length ? <ul>{portfolio.inclusionCriteria.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="note">No specific inclusion criteria extracted.</p>}</div>
            <div><strong>What disqualifies</strong>{portfolio.exclusionCriteria.length ? <ul>{portfolio.exclusionCriteria.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="note">No specific exclusion criteria extracted.</p>}</div>
          </div>
          {portfolio.targetMetrics && Object.keys(portfolio.targetMetrics).length > 0 && (
            <p className="note"><strong>Target metrics:</strong> {Object.entries(portfolio.targetMetrics).map(([key, value]) => `${key}: ${value}`).join(' · ')}</p>
          )}
        </article>
      ))}
      {criteria.globalConstraints.length > 0 && <div className="thesis-global-constraints"><strong>Portfolio-wide constraints</strong><ul>{criteria.globalConstraints.map((item) => <li key={item}>{item}</li>)}</ul></div>}
    </div>
  );
}