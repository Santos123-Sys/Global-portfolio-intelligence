'use client';

import { useCallback, useEffect, useState, useRef, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { type ThesisCriteria, emptyThesisPolicy, diffThesis, type ThesisExtractionResult } from '@portfolio-intelligence/agentic-contract';
import { ThesisDraft } from '@/lib/thesis-draft';
import { assessThesisReview } from '@/lib/thesis-review';
import { ThesisDiscoveryPreview } from '@/components/thesis-discovery-preview';
import { ThesisCriteriaEditor } from '@/components/thesis-criteria-editor';
import { canDismissThesisExtraction } from '@/lib/thesis-extraction-lifecycle';
import { normalizeThesisMandateCurrency } from '@/lib/thesis-currency';

interface ThesisVersionRow {
  id: string;
  versionNumber: number;
  criteriaJson: unknown;
  effectiveDate: string;
  supersededAt: string | null;
}

interface ExtractionRow {
  id: string;
  externalExtractionId: string;
  status: string;
  requestedVersion: number;
  sourceFileName: string;
  resultJson: ThesisExtractionResult | null;
  errorMessage: string | null;
  requestedAt: string;
  confirmedAt: string | null;
}

interface GeneratedMandateDraft { label: string; currency: string; objective: string; inclusionCriteria: string; exclusionCriteria: string; }
interface ThesisGeneratorDraft {
  title: string; investorName: string; purpose: string; timeHorizon: string; riskTolerance: string;
  markets: string; globalConstraints: string; reviewCadence: string; mandates: GeneratedMandateDraft[];
}
const EMPTY_MANDATE: GeneratedMandateDraft = { label: '', currency: '', objective: '', inclusionCriteria: '', exclusionCriteria: '' };
const INITIAL_GENERATOR: ThesisGeneratorDraft = {
  title: 'My investment thesis', investorName: '', purpose: '', timeHorizon: 'Long term (five years or more)', riskTolerance: 'Moderate',
  markets: '', globalConstraints: '', reviewCadence: 'Quarterly', mandates: [{ ...EMPTY_MANDATE }],
};
const listFromLines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean);

function downloadGeneratedPdf(fileName: string, contentBase64: string): void {
  const bytes = Uint8Array.from(atob(contentBase64), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a'); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url);
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
  const [manual, setManual] = useState(false);
  const [baseVersionId, setBaseVersionId] = useState<string | null>(null);
  const [nextVersion, setNextVersion] = useState(1);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState('Edits are not yet saved');
  const [loading, setLoading] = useState(true);
  const restored = useRef(false);
  const confirming = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transitionNotice, setTransitionNotice] = useState<string | null>(null);
  const [generator, setGenerator] = useState<ThesisGeneratorDraft>(INITIAL_GENERATOR);
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
    if (!pendingExtractionIds) return;
    const pendingIds = pendingExtractionIds.split('|');
    const interval = window.setInterval(async () => {
      try {
      const refreshed = await Promise.all(pendingIds.map(async (externalExtractionId) => {
        const response = await fetch(`/api/integrations/agentic/thesis-extractions?externalExtractionId=${encodeURIComponent(externalExtractionId)}`);
        if (!response.ok) return null;
        const body = await response.json() as { extraction: ExtractionRow };
        return body.extraction;
      }));
      setExtractions((current) => current.map((item) =>
        refreshed.find((candidate) => candidate?.externalExtractionId === item.externalExtractionId) ?? item
      ));
      } catch { setError('Could not refresh extraction status. Your draft remains available; retry loading when the connection returns.'); }
    }, 3_000);
    return () => window.clearInterval(interval);
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
      setCriteriaDraft(parsed.data.criteria); setSelectedId(parsed.data.selectedId);
      setManual(Boolean(saved.manual)); setBaseVersionId(saved.baseVersionId ?? null);
      setReviewNotes(typeof saved.reviewNotes === 'string' ? saved.reviewNotes : '');
      setSaveStatus('Recovered draft from this browser tab');
    } catch { setSaveStatus('Draft recovery is unavailable in this browser. Keep this page open.'); }
  }, [ownerId]);

  useEffect(() => {
    if (!ownerId || !criteriaDraft || !restored.current) return;
    try {
      sessionStorage.setItem(`thesis-draft:${ownerId}`, JSON.stringify({ schemaVersion: 1, criteria: criteriaDraft, selectedId, manual, baseVersionId, reviewNotes }));
      setSaveStatus('Draft saved in this browser tab — not yet approved');
    } catch { setSaveStatus('Draft could not be saved in this browser. Keep this page open and approve when ready.'); }
  }, [ownerId, criteriaDraft, selectedId, manual, baseVersionId, reviewNotes]);

  useEffect(() => {
    if (!criteriaDraft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [criteriaDraft]);

  function startDraft(thesis?: ThesisVersionRow) {
    if (criteriaDraft && !window.confirm('Replace the current draft? Its unapproved edits will be discarded.')) return;
    const current = versions.find(v=>!v.supersededAt);
    setBaseVersionId(current?.id ?? null); setSelectedId(null); setManual(true); setReviewNotes('');
    setCriteriaDraft(thesis ? { ...structuredClone(thesis.criteriaJson as ThesisCriteria), version: nextVersion } : {
      version: nextVersion, portfolios: [{role:'swiss_quality',currency:'CHF',objective:'',inclusionCriteria:[],exclusionCriteria:[],policy:emptyThesisPolicy()}],globalConstraints:[]
    });
    setError(null);
  }

  const draftReview = criteriaDraft ? assessThesisReview(criteriaDraft) : null;
  const staleDraft = !!criteriaDraft && (criteriaDraft.version !== nextVersion || baseVersionId !== (versions.find(v=>!v.supersededAt)?.id ?? null));
  const selected = extractions.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (selected?.status === 'completed' && selected.resultJson && !criteriaDraft && !manual) {
      setCriteriaDraft(structuredClone(selected.resultJson.criteria));
    }
  }, [selected, criteriaDraft, manual]);

  async function upload(file: File | null) {
    if (!file) return;
    if (criteriaDraft && !window.confirm('Replace the current unapproved draft with this document?')) return;
    setBusy(true);
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
      setManual(false); setBaseVersionId(versions.find(v=>!v.supersededAt)?.id ?? null);
      setExtractions((current) => [body.extraction!, ...current]);
      setSelectedId(body.extraction.id);
      setCriteriaDraft(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updateMandate(index: number, field: keyof GeneratedMandateDraft, value: string) {
    setGenerator((current) => ({ ...current, mandates: current.mandates.map((mandate, i) => i === index ? { ...mandate, [field]: value } : mandate) }));
  }

  async function generateThesis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (criteriaDraft && !window.confirm('Replace the current unapproved draft?')) return;
    setBusy(true); setError(null); setTransitionNotice(null);
    try {
      const response = await fetch('/api/thesis/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          ...generator, markets: listFromLines(generator.markets), globalConstraints: listFromLines(generator.globalConstraints),
          mandates: generator.mandates.map((mandate) => ({ ...mandate, inclusionCriteria: listFromLines(mandate.inclusionCriteria), exclusionCriteria: listFromLines(mandate.exclusionCriteria) })),
        }),
      });
      const body = await response.json().catch(() => ({})) as { extraction?: ExtractionRow; generatedDocument?: { fileName: string; contentBase64: string }; error?: string };
      if (!response.ok || !body.extraction) throw new Error(body.error ?? `Thesis generation failed (${response.status})`);
      if (body.generatedDocument) downloadGeneratedPdf(body.generatedDocument.fileName, body.generatedDocument.contentBase64);
      setManual(false); setBaseVersionId(versions.find(v=>!v.supersededAt)?.id ?? null);
      setExtractions((current) => [body.extraction!, ...current]); setSelectedId(body.extraction.id); setCriteriaDraft(null);
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }

  function review(extraction: ExtractionRow) {
    if (criteriaDraft && !window.confirm('Replace the current unapproved draft?')) return;
    setManual(false); setBaseVersionId(versions.find(v=>!v.supersededAt)?.id ?? null);
    setReviewNotes('');
    setSelectedId(extraction.id);
    setCriteriaDraft(extraction.resultJson ? structuredClone(extraction.resultJson.criteria) : null);
    setError(null);
  }

  async function confirm(startDiscovery = true) {
    if ((!selected && !manual) || confirming.current) return;
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
      setCriteriaDraft(null); setManual(false);
      if (ownerId) { try { sessionStorage.removeItem(`thesis-draft:${ownerId}`); } catch {} }
      if (body.discoveryTransition?.status === 'started' || body.discoveryTransition?.status === 'existing') {
        router.push('/ai-stock-discovery');
      } else if (body.discoveryTransition?.status === 'not_requested') {
        setTransitionNotice('Thesis approved. Open Discovery when you are ready to search using this version.');
        await load();
      } else {
        setTransitionNotice(
          `The thesis was confirmed, but market research did not start: ${body.discoveryTransition?.errorMessage ?? 'the transition was not accepted'}. ` +
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
        setSelectedId(null); setCriteriaDraft(null); setManual(false);
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
      if (!manual) { setSelectedId(null); setCriteriaDraft(null);
        if (ownerId) { try { sessionStorage.removeItem(`thesis-draft:${ownerId}`); } catch {} }
      }
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Investment Thesis</h1>
      <p className="sub">Define your strategy, review what Discovery will search for, then approve a version.</p>

      {error && <p className="caveat" role="alert">{error}</p>}
      {transitionNotice && <p className="caveat" role="status">{transitionNotice}</p>}

      <section className="card">
        <h2>Define your investment mandate</h2>
        <p className="note">Draft → Review issues → Approve → Discovery. Automated research currently covers B3 and SIX.</p>
        {loading ? <p role="status">Loading your thesis workspace…</p> : <button type="button" className="action-button" disabled={busy || !!error} onClick={()=>startDraft()}>Create structured thesis</button>}
        {error && <button type="button" className="secondary-button" onClick={()=>void load().catch(e=>setError(e.message))}>Retry loading</button>}
      </section>
      <details className="card"><summary>Create a PDF from a questionnaire (optional)</summary>
        <h2>Build a thesis document</h2>
        <p className="note">Answer the questions below. Portfolio Intelligence will prepare a professional, static PDF, download a copy for you, and send that exact document to the thesis extractor. You review and confirm the resulting mandate before it is used.</p>
        <form className="thesis-generator" onSubmit={(event) => void generateThesis(event)}>
          <div className="grid">
            <label>Thesis title<input value={generator.title} maxLength={120} required onChange={(event) => setGenerator((current) => ({ ...current, title: event.target.value }))} /></label>
            <label>Investor or household name<input value={generator.investorName} maxLength={120} required onChange={(event) => setGenerator((current) => ({ ...current, investorName: event.target.value }))} /></label>
            <label>Time horizon<input value={generator.timeHorizon} maxLength={120} required onChange={(event) => setGenerator((current) => ({ ...current, timeHorizon: event.target.value }))} /></label>
            <label>Risk posture<select value={generator.riskTolerance} onChange={(event) => setGenerator((current) => ({ ...current, riskTolerance: event.target.value }))}><option>Conservative</option><option>Moderate</option><option>Growth-oriented</option><option>Aggressive</option></select></label>
          </div>
          <label>What is this capital intended to achieve?<textarea value={generator.purpose} minLength={2} maxLength={2000} required onChange={(event) => setGenerator((current) => ({ ...current, purpose: event.target.value }))} /></label>
          <div className="grid">
            <label>Markets or geographies <span className="note">(one per line)</span><textarea value={generator.markets} required placeholder={'Switzerland\nBrazil'} onChange={(event) => setGenerator((current) => ({ ...current, markets: event.target.value }))} /></label>
            <label>Portfolio-wide constraints <span className="note">(one per line; optional)</span><textarea value={generator.globalConstraints} placeholder={'Avoid excessive leverage\nKeep a liquidity reserve'} onChange={(event) => setGenerator((current) => ({ ...current, globalConstraints: event.target.value }))} /></label>
          </div>
          <label>How often should this thesis be reviewed?<input value={generator.reviewCadence} maxLength={120} required onChange={(event) => setGenerator((current) => ({ ...current, reviewCadence: event.target.value }))} /></label>
          <div className="thesis-generator-mandates">
            <div className="section-row"><h3>Portfolio destinations</h3><p className="note">Create one destination for every distinct strategy in your thesis.</p></div>
            {generator.mandates.map((mandate, index) => <article className="thesis-mandate" key={index}>
              <div className="grid">
                <label>Portfolio name<input value={mandate.label} maxLength={100} required placeholder="Swiss quality" onChange={(event) => updateMandate(index, 'label', event.target.value)} /></label>
                <label>Base currency<input value={mandate.currency} minLength={3} maxLength={3} required placeholder="CHF" onChange={(event) => updateMandate(index, 'currency', event.target.value.toUpperCase())} /></label>
              </div>
              <label>What should this portfolio achieve?<textarea value={mandate.objective} maxLength={1000} required onChange={(event) => updateMandate(index, 'objective', event.target.value)} /></label>
              <div className="grid">
                <label>What qualifies? <span className="note">(one criterion per line)</span><textarea value={mandate.inclusionCriteria} onChange={(event) => updateMandate(index, 'inclusionCriteria', event.target.value)} /></label>
                <label>What disqualifies? <span className="note">(one criterion per line)</span><textarea value={mandate.exclusionCriteria} onChange={(event) => updateMandate(index, 'exclusionCriteria', event.target.value)} /></label>
              </div>
              {generator.mandates.length > 1 && <button className="secondary-button" type="button" onClick={() => setGenerator((current) => ({ ...current, mandates: current.mandates.filter((_, i) => i !== index) }))}>Remove destination</button>}
            </article>)}
            {generator.mandates.length < 8 && <button className="secondary-button" type="button" onClick={() => setGenerator((current) => ({ ...current, mandates: [...current.mandates, { ...EMPTY_MANDATE }] }))}>Add another destination</button>}
          </div>
          <button className="action-button" type="submit" disabled={busy}>{busy ? 'Creating and extracting…' : 'Create thesis PDF and extract it'}</button>
        </form>
      </details>

      <section className="card">
        <h2>Or submit an existing thesis</h2>
        <p className="note">PDF up to 10 MB, or UTF-8 plain text/Markdown up to 2 MB. Static office exports are supported; executable actions, embedded files, forms, and encrypted PDFs are rejected. Extraction never becomes canonical automatically.</p>
        <label className="action-button" style={{ display: 'inline-block', cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'Working…' : 'Choose thesis document'}
          <input
            type="file"
            accept="application/pdf,text/plain,text/markdown,.pdf,.md,.txt"
            hidden
            disabled={busy}
            onChange={(event) => void upload(event.target.files?.[0] ?? null)}
          />
        </label>
      </section>

      <section className="card">
        <h2>Document review queue</h2>
        {extractions.length === 0 ? <p className="note">No extraction submitted yet.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Document</th><th>Version</th><th>Status</th><th>Submitted</th><th>Action</th></tr></thead>
              <tbody>{extractions.map((extraction) => (
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
      </section>

      {(selected?.resultJson || manual) && (
        <section className="card">
          <h2>Review and approve thesis</h2>
          <p role="status">{ownerId ? saveStatus : 'Draft is in memory; keep this page open until approval.'}</p>
          <fieldset disabled={busy} className="thesis-review-fields">
          {staleDraft && <div role="alert" className="caveat"><p>The approved thesis changed. Compare your draft with the current version below before proceeding.</p>{manual ? <button type="button" className="secondary-button" onClick={()=>{
            setBaseVersionId(versions.find(v=>!v.supersededAt)?.id ?? null);
            setCriteriaDraft(current=>current ? {...current,version:nextVersion} : current);
            setReviewNotes(''); setError(null);
          }}>Keep my edits and review against the latest version</button> : <p>This extraction targets an older version. Submit the document again to obtain an extraction for the current next version.</p>}</div>}

          {selected?.resultJson && <p className="note">Model-reported extraction confidence (not a correctness guarantee): {(selected.resultJson.extractionConfidence * 100).toFixed(0)}%. Review the source-derived mandate below, then confirm. Only markets supported by configured discovery providers can start automated market research.</p>}
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
            <h3>{draftReview.errors.length ? 'Not ready for approval' : 'Readiness check'}</h3>
            <ul><li>Mandate and reporting currency: {draftReview.errors.length ? 'review issues below' : 'validated'}</li><li>Structured universe and rules: {criteriaDraft?.portfolios.every(p=>p.policy) ? 'defined; review search preview' : 'legacy prose needs acknowledgment'}</li><li>Blocking contradictions: {draftReview.errors.length}</li><li>Ambiguities / review notes: {draftReview.needsAcknowledgment && reviewNotes.trim().length<20 ? 'acknowledgment required' : 'reviewed or none detected'}</li></ul>
            {!!draftReview.issues.length && <details><summary>Ambiguities requiring judgment and observations ({draftReview.issues.length})</summary>{draftReview.issues.map((issue,i)=><article key={i}><p><strong>{issue.severity} · {issue.location}</strong> — “{issue.statement}”</p><p>{issue.reason}</p><p><strong>Interpretation:</strong> {issue.interpretation}</p>{issue.proxy&&<p><strong>Possible proxy:</strong> {issue.proxy}</p>}</article>)}</details>}
            <ThesisDiscoveryPreview criteria={draftReview.criteria}/>
            {versions.find(v=>!v.supersededAt) && <details><summary>Changes from the active version — Discovery should be rerun after material changes</summary><ul>{diffThesis(versions.find(v=>!v.supersededAt)!.criteriaJson as ThesisCriteria,draftReview.criteria).map(change=><li key={change.path}>{change.kind}: {change.path.replace(/([A-Z])/g,' $1')} — {change.previous??'not set'} → {change.current??'removed'}</li>)}</ul><p>Historical runs retain their original thesis; their candidates have not been certified against this draft.</p></details>}
          </>}
          <label className="setup-form">Review decision
            <textarea value={reviewNotes} maxLength={4000} onChange={event => setReviewNotes(event.target.value)} placeholder="Explain what you corrected, retained or deferred and why." />
          </label>
          <p className="note">A review note of at least 20 characters is required for review warnings, extraction ambiguities or unmapped content. The original extraction, your edits and this note are retained in the confirmation audit.</p>
          <p className="note">Every portfolio destination needs a native three-letter currency. Swiss Quality and Brazilian Growth use CHF and BRL respectively; for every other mandate, set the source currency here before confirmation.</p>
          <button className="action-button" type="button" onClick={() => void confirm()} disabled={busy || staleDraft || !criteriaDraft || !!draftReview?.errors.length || (!!(draftReview?.needsAcknowledgment || selected?.resultJson?.ambiguousPoints.length || selected?.resultJson?.unmappedContent.length) && reviewNotes.trim().length < 20) || !!selected?.confirmedAt}>
            Confirm thesis version {criteriaDraft?.version} &amp; start market research
          </button>
          <button type="button" className="secondary-button" onClick={()=>void confirm(false)} disabled={busy || staleDraft || !criteriaDraft || !!draftReview?.errors.length || (!!(draftReview?.needsAcknowledgment || selected?.resultJson?.ambiguousPoints.length || selected?.resultJson?.unmappedContent.length) && reviewNotes.trim().length<20) || !!selected?.confirmedAt}>Approve without starting Discovery</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={()=>{
            if (!window.confirm('Discard this unapproved draft? Approved versions are preserved.')) return;
            setCriteriaDraft(null); setSelectedId(null); setManual(false); setReviewNotes('');
            if (ownerId) { try { sessionStorage.removeItem(`thesis-draft:${ownerId}`); } catch { setError('Draft recovery could not be cleared from this browser tab.'); } }
          }}>Discard unapproved draft</button>
          </fieldset>
        </section>
      )}

      <section className="card">
        <h2>Confirmed versions</h2>
        {versions.length === 0 ? <p className="note">No thesis version has been confirmed.</p> : (
          <div className="grid">{versions.map((thesis) => (
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
              <button type="button" className="secondary-button" disabled={busy} onClick={()=>startDraft(thesis)}>Edit as a new version</button>
              <details><summary>Advanced export</summary><button type="button" className="secondary-button" onClick={() => {
                const url = URL.createObjectURL(new Blob([JSON.stringify({ thesisVersionId: thesis.id, effectiveDate: thesis.effectiveDate, criteria: thesis.criteriaJson }, null, 2)], { type: 'application/json' }));
                const link = document.createElement('a'); link.href = url; link.download = `thesis-version-${thesis.versionNumber}.json`; link.click(); URL.revokeObjectURL(url);
              }}>Download confirmed criteria (JSON)</button></details>
              <ThesisSummary criteria={thesis.criteriaJson as ThesisCriteria} />
              <ThesisDiscoveryPreview criteria={thesis.criteriaJson as ThesisCriteria} />
            </article>
          ))}</div>
        )}
      </section>
    </main>
  );
}

function roleLabel(role: string): string {
  return role.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ThesisSummary({
  criteria,
  editable = false,
  onCurrencyChange,
}: {
  criteria: ThesisCriteria;
  editable?: boolean;
  onCurrencyChange?: (index: number, value: string) => void;
}) {
  return (
    <div className="thesis-summary" aria-label="Thesis criteria summary">
      {criteria.portfolios.map((portfolio, index) => (
        <article className="thesis-mandate" key={`${portfolio.role}-${index}`}>
          <div className="thesis-mandate-heading">
            <h3>{roleLabel(portfolio.role)}</h3>
            {editable ? (
              <label className="thesis-currency-field">Source currency
                <input
                  value={portfolio.currency}
                  onChange={(event) => onCurrencyChange?.(index, event.target.value)}
                  aria-label={`${roleLabel(portfolio.role)} source currency`}
                  placeholder="Unspecified or CHF"
                />
              </label>
            ) : <span className="badge watch">Source currency: {normalizeThesisMandateCurrency(portfolio.currency) === 'Unspecified' ? 'Not specified' : normalizeThesisMandateCurrency(portfolio.currency)}</span>}
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

