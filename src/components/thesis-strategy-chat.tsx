'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { emptyThesisPolicy, type ThesisCriteria, type ThesisExtractionResult } from '@portfolio-intelligence/agentic-contract';
import { PortfolioStrategyDraft, type PortfolioStrategyDraft as StrategyDraft } from '@/lib/portfolio-strategy-chat';

type Message = { role: 'user' | 'assistant'; content: string };
interface GeneratedExtraction {
  id: string;
  externalExtractionId: string;
  status: string;
  requestedVersion: number;
  sourceFileName: string;
  resultJson: ThesisExtractionResult;
  errorMessage: string | null;
  requestedAt: string;
  confirmedAt: null;
}
interface StrategyChatResult {
  reply: string;
  status: 'clarifying' | 'ready';
  missingFields: string[];
  draft: StrategyDraft | null;
}

function downloadPdf(fileName: string, base64: string): void {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function strategyDraftFromCriteria(criteria: ThesisCriteria): StrategyDraft {
  const constraints = [...criteria.globalConstraints];
  const removePrefixed = (prefix: string) => {
    const index = constraints.findIndex((value) => value.startsWith(prefix));
    if (index < 0) return '';
    return constraints.splice(index, 1)[0]!.slice(prefix.length).trim();
  };
  const riskTolerance = removePrefixed('Risk posture:');
  const reviewCadence = removePrefixed('Review cadence:');
  const markets = [...new Set(criteria.portfolios.flatMap((portfolio) => {
    const universe = portfolio.policy?.universe;
    return [...(universe?.listingMarkets ?? []), ...(universe?.domicileCountries ?? [])];
  }))];
  return PortfolioStrategyDraft.parse({
    title: criteria.portfolios[0]?.policy?.name || 'Portfolio strategy update',
    investorName: '',
    purpose: criteria.portfolios.map((portfolio) => portfolio.objective).join('\n\n'),
    timeHorizon: criteria.portfolios[0]?.policy?.horizon || 'Not specified',
    riskTolerance: riskTolerance || 'Not specified',
    reviewCadence: reviewCadence || 'As needed',
    markets: markets.length ? markets : ['Not specified'],
    globalConstraints: constraints,
    mandates: criteria.portfolios.map((portfolio) => ({
      label: portfolio.policy?.name || portfolio.role.replaceAll('_', ' '),
      role: portfolio.role,
      currency: portfolio.currency,
      objective: portfolio.objective,
      inclusionCriteria: portfolio.inclusionCriteria,
      exclusionCriteria: portfolio.exclusionCriteria,
      policy: portfolio.policy ? structuredClone(portfolio.policy) : emptyThesisPolicy(),
    })),
  });
}

export function ThesisStrategyChat({
  nextVersion,
  startingCriteria,
  onGenerated,
}: {
  nextVersion: number;
  startingCriteria?: ThesisCriteria | null;
  onGenerated: (extraction: GeneratedExtraction) => void;
}) {
  const initialDraft = useMemo(() => startingCriteria ? strategyDraftFromCriteria(startingCriteria) : null, [startingCriteria]);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: initialDraft
      ? 'I have the currently approved strategy as a starting point. Tell me what you want to change, add a new constraint, or describe how the mandate should evolve.'
      : 'Tell me what you want your portfolio strategy to achieve. You can describe it in your own words; I will ask about any essential decisions that are still unclear.' },
  ]);
  const [currentDraft, setCurrentDraft] = useState<StrategyDraft | null>(initialDraft);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = message.trim();
    if (!content || busy) return;
    const nextMessages = [...messages, { role: 'user' as const, content }];
    setMessages(nextMessages);
    setMessage('');
    setBusy(true);
    setError(null);
    setReady(false);
    try {
      const response = await fetch('/api/thesis/strategy-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, currentDraft, nextVersion }),
      });
      const body = await response.json().catch(() => ({})) as StrategyChatResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Strategy assistant failed (${response.status})`);
      setMessages((items) => [...items, { role: 'assistant', content: body.reply }]);
      setCurrentDraft(body.draft);
      setReady(body.status === 'ready' && !!body.draft);
      requestAnimationFrame(() => transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' }));
    } catch (cause) {
      setMessages(nextMessages);
      setError((cause as Error).message);
      setMessage(content);
    } finally {
      setBusy(false);
    }
  }

  async function generatePdf() {
    if (!currentDraft || busy) return;
    const validated = PortfolioStrategyDraft.safeParse(currentDraft);
    if (!validated.success) {
      setError('The draft needs another clarification. Continue the conversation and try again.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/thesis/strategy-chat/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validated.data),
      });
      const body = await response.json().catch(() => ({})) as {
        extraction?: GeneratedExtraction;
        generatedDocument?: { fileName: string; contentBase64: string };
        error?: string | { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
        review?: { errors?: string[] };
      };
      if (!response.ok || !body.extraction || !body.generatedDocument) {
        const errors = body.review?.errors?.join(' ') ?? (typeof body.error === 'string' ? body.error : 'The strategy could not be prepared for review.');
        throw new Error(errors);
      }
      downloadPdf(body.generatedDocument.fileName, body.generatedDocument.contentBase64);
      onGenerated(body.extraction);
      setReady(false);
      setCurrentDraft(null);
      setMessages([{ role: 'assistant', content: 'Your strategy PDF is ready. Review the structured mandate below, correct anything needed, and approve it when you are satisfied.' }]);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="card strategy-chat-card" aria-labelledby="strategy-chat-title">
    <div className="section-heading">
      <div><p className="analysis-eyebrow">{startingCriteria ? 'Strategy update' : 'Start here'}</p><h2 id="strategy-chat-title">Build your strategy with Gemini</h2></div>
      <span className="badge">Interactive draft</span>
    </div>
    <p className="note">Describe your goals and constraints. Gemini will ask focused follow-up questions and turn your answers into a reviewable mandate. It does not research securities or approve changes.</p>
    <div className="strategy-chat-transcript" ref={transcriptRef} aria-label="Strategy conversation" aria-live="polite" aria-relevant="additions text">
      {messages.map((entry, index) => <article className={`strategy-chat-message ${entry.role}`} key={`${entry.role}-${index}`}>
        <strong>{entry.role === 'assistant' ? 'Strategy assistant' : 'You'}</strong>
        <p>{entry.content}</p>
      </article>)}
      {busy && <p className="strategy-chat-status" role="status">Gemini is reviewing your answers…</p>}
    </div>
    {ready && currentDraft && <div className="strategy-chat-ready" role="status">
      <div><strong>Draft ready for review</strong><p className="note">{currentDraft.mandates.length} portfolio destination{currentDraft.mandates.length === 1 ? '' : 's'} · {currentDraft.markets.join(', ')} · {currentDraft.timeHorizon}</p></div>
      <ul>{currentDraft.mandates.map((mandate, index) => <li key={`${mandate.role}-${index}`}><strong>{mandate.label}</strong> · {mandate.currency} — {mandate.objective}</li>)}</ul>
      <p className="note">The PDF records the investment thesis, eligible universe, selection rules, risk limits and review process. Check every field before approving.</p>
      <button className="action-button" type="button" onClick={() => void generatePdf()} disabled={busy}>Generate strategy PDF and review</button>
    </div>}
    {error && <p className="caveat" role="alert">{error}</p>}
    <form className="strategy-chat-composer" onSubmit={(event) => void send(event)}>
      <label htmlFor="strategy-chat-message">Your answer</label>
      <textarea id="strategy-chat-message" value={message} maxLength={4_000} rows={3} disabled={busy} placeholder="For example: I want a long-term Brazilian equity portfolio focused on profitable growth, with moderate risk…" onChange={(event) => setMessage(event.target.value)} />
      <div className="strategy-chat-actions"><span className="note">You can change or clarify anything before generating the PDF.</span><button className="secondary-button" type="submit" disabled={busy || !message.trim()}>{busy ? 'Working…' : 'Send'}</button></div>
    </form>
  </section>;
}
