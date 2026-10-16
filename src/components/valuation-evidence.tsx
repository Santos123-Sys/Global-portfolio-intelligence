'use client';
import {useEffect, useRef, useState} from 'react';
import type {ValuationAudit, LineageNode} from '@/lib/integrations/valuation-lineage';

const descriptions: Record<LineageNode['status'], string> = {
  source_linked: 'A metric and period source locator is attached; this is not independent financial reconciliation.',
  user_supplied: 'Analyst input. Accepting an assumption does not verify it as a reported fact.',
  calculated: 'Deterministic calculation; reliability depends on its inputs and conventions.',
  unverified: 'Supporting evidence is missing or incomplete.',
  conflicting_evidence: 'A stored discrepancy requires review before relying on this amount.',
};
const amount = (node: LineageNode) => node.value === null ? 'Unavailable' :
  `${typeof node.value === 'number' ? node.value.toLocaleString('en-US', {maximumFractionDigits: 6}) : node.value} ${node.unit}`;

/** Highlight only a complete numeric token already present in the saved quotation. */
function supportingQuote(quote: string, value: LineageNode['value']) {
  if (typeof value !== 'number') return quote;
  const formatted = Math.abs(value).toLocaleString('en-US', {maximumFractionDigits: 12});
  const candidates = value < 0 ? [`(${formatted})`, `-${formatted}`, String(value)] : [formatted, String(value)];
  for (const token of candidates) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp('(^|[^\\d,.(-])(' + escaped + ')(?=$|[^\\d,.)])').exec(quote);
    if (!match) continue;
    const index = match.index + match[1].length;
    return <>{quote.slice(0, index)}<mark>{token}</mark>{quote.slice(index + token.length)}</>;
  }
  return quote;
}

/** Reads a saved, account-authorized graph on demand; no provider credentials enter the client. */
export function ValuationEvidence({candidateKey, valuation}: {candidateKey: string; valuation: {
  valuationVersionId: string; method: 'dcf' | 'comps'; currency: string; impliedValuePerShare: string;
}}) {
  const [open, setOpen] = useState(false);
  const [audit, setAudit] = useState<ValuationAudit | null>(null);
  const [error, setError] = useState('');
  const [path, setPath] = useState<string[]>([]);
  const [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const rootId = valuation.method + ':implied_per_share';
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const controller = new AbortController();
    const query = new URLSearchParams({candidateKey, valuationVersionId: valuation.valuationVersionId});
    void fetch('/api/integration/v1/valuation-audit?' + query, {cache: 'no-store', signal: controller.signal})
      .then(async response => {
        if (!response.ok) throw Error('Evidence could not be verified or is unavailable. Reopen FilingLens to review the saved analysis.');
        const result = await response.json();
        if (result.status !== 'ready' || !result.audit) throw Error('Saved source evidence is unavailable.');
        if (!controller.signal.aborted) {setAudit(result.audit); setPath([rootId]);}
      }).catch(reason => {if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Evidence unavailable.');});
    return () => controller.abort();
  }, [candidateKey, open, retry, rootId, valuation.valuationVersionId]);
  const selected = audit?.lineage.nodes[path.at(-1) ?? rootId];
  useEffect(() => {if (selected) heading.current?.focus();}, [selected]);
  function exportEvidence() {
    if (!audit) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(audit, null, 2)], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'GPI-valuation-evidence.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <>
    <button ref={trigger} className="secondary" aria-haspopup="dialog"
      aria-label={`Inspect ${candidateKey} reviewed valuation evidence`}
      onClick={() => {setAudit(null); setError(''); setPath([]); setOpen(true);}}>
      {valuation.currency} {valuation.impliedValuePerShare}/share · inspect evidence
    </button>
    {open && <dialog ref={dialog} className="valuation-evidence" aria-labelledby="valuation-evidence-title"
      onClose={() => {setOpen(false); trigger.current?.focus();}}>
      <header><h2 id="valuation-evidence-title">Saved valuation evidence · {candidateKey}</h2>
        <button type="button" onClick={() => dialog.current?.close()}>Close evidence</button></header>
      <p>Review the source, calculation and inputs for this approved version. Original document access remains subject to its publisher’s permissions.</p>
      {!audit && !error && <p role="status">Loading saved evidence…</p>}
      {error && <><p role="alert">{error}</p><button onClick={() => {setError(''); setRetry(value => value + 1);}}>Retry evidence</button></>}
      {audit && <>
        <p>{audit.lineage.issuer.name} · {audit.issuerId} · {audit.lineage.accountingBasis} · {audit.lineage.scope}</p>
        <p>Calculation {audit.lineage.calculationVersion} · valuation date {audit.lineage.valuationDate ?? 'Unavailable'}</p>
        <nav aria-label="Calculation lineage"><button disabled={path.length < 2} onClick={() => setPath(value => value.slice(0, -1))}>Back to previous input</button>
          <button disabled={path.length < 2} onClick={() => setPath([rootId])}>Return to valuation</button>
          <button onClick={exportEvidence}>Export saved evidence</button></nav>
        {selected && <article>
          <h3 ref={heading} tabIndex={-1}>{selected.label}: {amount(selected)}</h3>
          <p>{selected.classification.replaceAll('_', ' ')} · {selected.period} · {selected.status.replaceAll('_', ' ')}</p>
          <p>{descriptions[selected.status]}</p>
          {selected.formula && <p><strong>Formula or convention:</strong> {selected.formula}</p>}
          <p><strong>Retrieval or calculation method:</strong> {selected.retrievalMethod}</p>
          {selected.inputs.length > 0 && <><h4>Inspect inputs</h4><ul>{selected.inputs.map(id => {
            const input = audit.lineage.nodes[id];
            return <li key={id}><button className="secondary" onClick={() => setPath(value => [...value, id])}>{input.label}: {amount(input)}</button></li>;
          })}</ul></>}
          <h4>Original evidence</h4>
          {!selected.sources.length && <p>No direct source is attached. Inspect the inputs; analyst assumptions are not issuer disclosures.</p>}
          {selected.sources.map((source, index) => <section key={index}>
            <p>{source.publisher ?? 'Publisher not recorded'} · {source.sourceForm ?? 'Document title not recorded'} · {source.section}
              {source.page ? ` · page ${source.page}` : ''}{source.item ? ` · ${source.item}` : ''}</p>
            {source.quote ? <blockquote>{supportingQuote(source.quote, selected.value)}</blockquote> : <p>Supporting quotation is unavailable.</p>}
            <p>Retrieved {source.accessed ?? 'timestamp unavailable'}</p>
            {source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer">Open original source</a> : <p>Original source link is unavailable.</p>}
          </section>)}
          {selected.checks.length > 0 && <><h4>Recorded checks</h4><ul>{selected.checks.map((check, i) => <li key={i}>{check}</li>)}</ul></>}
          {selected.limitations.length > 0 && <><h4>Limitations</h4><ul>{selected.limitations.map((limit, i) => <li key={i}>{limit}</li>)}</ul></>}
        </article>}
      </>}
    </dialog>}
  </>;
}
