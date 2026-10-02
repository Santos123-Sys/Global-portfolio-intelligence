'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { emptyThesisPolicy, type ThesisCriteria, type ThesisExtractionResult } from '@portfolio-intelligence/agentic-contract';
import { PortfolioStrategyDraft, type PortfolioStrategyDraft as StrategyDraft } from '@/lib/portfolio-strategy-chat';
import { PortfolioCreatorState, type CreatorSession } from '@/lib/portfolio-creator-state';
import { INVESTOR_QUESTIONS, assessInvestorProfile, type QuestionId } from '@/lib/investor-profile';
import { useLanguage } from '@/lib/i18n';
import { InvestorProfileSummary } from './investor-profile-summary';
interface GeneratedExtraction { id: string; externalExtractionId: string; status: string; requestedVersion: number; sourceFileName: string; resultJson: ThesisExtractionResult; errorMessage: string | null; requestedAt: string; confirmedAt: null }
function downloadPdf(fileName: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a'); link.href = url; link.download = fileName; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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

export function PortfolioCreator({ startingCriteria, onGenerated }: { nextVersion: number; startingCriteria?: ThesisCriteria | null; onGenerated: (extraction: GeneratedExtraction) => void }) {
  const { language } = useLanguage(); const pt = language === 'pt';
  const [saved, setSaved] = useState<CreatorSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'answer' | 'thinking' | 'pdf' | 'confirm' | null>(null);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [scope, setScope] = useState<'equity_sleeve' | 'full_equity'>('equity_sleeve');
  const [acknowledged, setAcknowledged] = useState(false); const [deviationReason, setDeviationReason] = useState('');
  const [resetRequested, setResetRequested] = useState(false);
  const [stalled, setStalled] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null); const turnAbort = useRef<AbortController | null>(null);
  const initialDraft = useMemo(() => startingCriteria ? strategyDraftFromCriteria(startingCriteria) : null, [startingCriteria]);
  const state = saved?.state;
  const answered = state ? Object.keys(state.answers).length : 0;
  const question = INVESTOR_QUESTIONS.find(q => !state?.answers[q.id]);
  const assessment = useMemo(() => state && answered === 11 ? assessInvestorProfile(state.answers) : null, [state, answered]);
  const working = busy === 'thinking' || state?.generationStatus === 'working';

  const receive = useCallback((body: { revision?: number; state?: unknown; stalled?: boolean }) => {
    if (typeof body.revision === 'number') {
      const parsed = PortfolioCreatorState.safeParse(body.state);
      if (parsed.success) setSaved(current => !current || body.revision! >= current.revision ? { revision: body.revision!, state: parsed.data } : current);
    }
    setStalled(Boolean(body.stalled));
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/thesis/portfolio-creator', { signal, cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Portfolio Creator could not load the saved interview');
    if (!signal?.aborted) { receive(body); setError(''); }
    return body as CreatorSession;
  }, [receive]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); turnAbort.current?.abort(); };
  }, [load]);
  useEffect(() => {
    if (state?.generationStatus !== 'working') return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { await load(controller.signal); } catch { if (!controller.signal.aborted) setError(pt ? 'Não foi possível atualizar. Suas respostas estão salvas; tentaremos novamente.' : 'Live status could not refresh. Your answers are saved; refresh will retry.'); }
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 2500);
    };
    timer = setTimeout(() => void refresh(), 2500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [state?.generationStatus, load, pt]);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [answered, state?.messages.length]);

  async function action(payload: Record<string, unknown>, kind: 'answer' | 'confirm' = 'answer') {
    if (!saved || busy) return;
    setBusy(kind); setError('');
    try {
      const response = await fetch('/api/thesis/portfolio-creator', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, revision: saved.revision }) });
      const body = await response.json(); receive(body);
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Choose one of the available answers');
      setMessage(''); setResetRequested(false); setAcknowledged(false); setDeviationReason('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the answer'); } finally { setBusy(null); }
  }
  async function answer(id: QuestionId, value: string) {
    await action({ action: 'answer', questionId: id, answer: value, language: pt ? 'pt' : 'en' });
  }
  async function send(event?: FormEvent<HTMLFormElement>, retry = false) {
    event?.preventDefault(); if (!saved || busy || working) return;
    if (state?.phase === 'profiling' && question) {
      const code = message.trim().toUpperCase();
      if (!/^[A-F]$/.test(code) || code.charCodeAt(0) - 65 >= question.points.length) { setError(pt ? 'Escolha uma alternativa ou digite sua letra para pontuarmos sem inferir sua resposta.' : 'Choose an option or type its letter so scoring does not infer your answer.'); return; }
      return answer(question.id, code);
    }
    const content = message.trim(); if (!retry && !content) return;
    const controller = new AbortController(); turnAbort.current = controller;
    setBusy('thinking'); setError('');
    try {
      const response = await fetch('/api/thesis/portfolio-creator', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: saved.revision, ...(retry ? { retry: true } : { message: content }), ...(state?.draft ? {} : { startingDraft: initialDraft }) }) });
      const body = await response.json(); if (controller.signal.aborted) return;
      receive(body);
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Portfolio Creator could not complete the turn');
      setMessage('');
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not complete this turn'); } finally { if (turnAbort.current === controller) { setBusy(null); turnAbort.current = null; } }
  }
  async function cancelTurn() {
    setError('');
    try {
      const current = await load();
      const response = await fetch('/api/thesis/portfolio-creator', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel_turn', revision: current.revision }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not stop the turn');
      turnAbort.current?.abort(); turnAbort.current = null; setBusy(null); receive(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not stop the turn'); }
  }
  async function generatePdf() {
    if (!saved || busy || working) return;
    setBusy('pdf'); setError('');
    try {
      const response = await fetch('/api/thesis/portfolio-creator/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: saved.revision, confirmed: true }) });
      const body = await response.json();
      if (body.session) receive(body.session);
      if (!response.ok || !body.extraction || !body.generatedDocument) throw new Error(body.error ?? 'The strategy could not be prepared for review');
      downloadPdf(body.generatedDocument.fileName, body.generatedDocument.contentBase64); onGenerated(body.extraction);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create the PDF'); } finally { setBusy(null); }
  }
  const stageNames = pt ? ['Perfil', 'Avaliação', 'Restrições', 'Estratégia', 'Revisão'] : ['Profile', 'Assessment', 'Constraints', 'Strategy', 'Review'];
  const stage = state ? ['profiling', 'profile_review', 'constraints', 'strategy_ready', 'document_ready'].indexOf(state.phase) : 0;
  return <section className="card glass-panel strategy-chat-card" aria-labelledby="portfolio-creator-title">
    <div className="section-heading"><div><p className="analysis-eyebrow">{startingCriteria ? (pt ? 'Atualização da estratégia' : 'Strategy update') : (pt ? 'Comece aqui' : 'Start here')}</p><h2 id="portfolio-creator-title" translate="no">Portfolio Creator</h2></div><span className="badge">{pt ? 'Entrevista salva' : 'Saved interview'}</span></div>
    <p className="note">{pt ? 'Primeiro identificamos seu perfil. Depois criamos uma estratégia com base nas suas restrições. O Portfolio Creator prepara propostas; você confirma o perfil e aprova a carteira. Não realiza operações nem muda pesos.' : 'First we assess your investor profile, then build a strategy from your constraints. Portfolio Creator prepares proposals; you confirm the profile and approve portfolio creation. It cannot trade or change weights.'}</p>
    <ol className="creator-progress" aria-label={pt ? 'Etapas da criação' : 'Portfolio creation stages'}>{stageNames.map((name, index) => <li key={name} aria-current={index === stage ? 'step' : undefined}>{index + 1}. {name}{index < stage ? ' ✓' : ''}</li>)}</ol>
    {loading && <p role="status">{pt ? 'Carregando a entrevista salva…' : 'Loading your saved interview…'}</p>}
    {!loading && !saved && <button type="button" className="secondary-button" onClick={() => void load().catch(cause => setError(cause.message))}>{pt ? 'Tentar carregar novamente' : 'Retry loading'}</button>}
    {saved && <>
      {state?.phase === 'profiling' && question && <>
        <div role="status"><progress value={answered} max={11} aria-label={pt ? 'Respostas do perfil salvas' : 'Saved profile answers'} /><p>{answered}/11 {pt ? 'respostas salvas' : 'answers saved'}</p></div>
        <div className="strategy-chat-transcript" ref={transcriptRef} aria-live="polite" aria-label={pt ? 'Conversa sobre o perfil' : 'Investor profile conversation'}>
          {answered > 0 && <details><summary>{pt ? 'Rever respostas anteriores' : 'Review earlier answers'}</summary>{INVESTOR_QUESTIONS.filter(q => state.answers[q.id]).map(q => <p key={q.id}><strong>{pt ? q.pt : q.question}</strong><br />{(pt ? q.optionsPt : q.options)[state.answers[q.id]!.charCodeAt(0) - 65]}</p>)}</details>}
          <article className="strategy-chat-message assistant"><strong translate="no">Portfolio Creator</strong><p>{pt ? question.pt : question.question}</p><p className="note">{pt ? 'Responda pensando em um único objetivo. Não há resposta certa; não inferimos escolhas não respondidas.' : 'Answer with one goal in mind. There is no right answer; unanswered choices are never inferred.'}</p></article>
        </div>
        <div className="creator-answer-options" role="group" aria-label={pt ? 'Escolha sua resposta' : 'Choose your answer'}>{(pt ? question.optionsPt : question.options).map((option, index) => <button className="secondary-button" type="button" key={index} disabled={busy !== null} onClick={() => void answer(question.id, String.fromCharCode(65 + index))}>{String.fromCharCode(65 + index)}. {option}</button>)}</div>
      </>}
      {assessment && <InvestorProfileSummary profile={assessment} language={pt ? 'pt' : 'en'} />}
      {state?.phase === 'profile_review' && assessment && <section className="creator-profile-confirmation" aria-label={pt ? 'Confirmar o perfil e o escopo' : 'Confirm profile and strategy scope'}>
        <h3>{pt ? 'Revise o perfil antes de continuar' : 'Review the profile before continuing'}</h3>
        <p>{pt ? 'O sistema pesquisa ações listadas. A parcela de renda fixa do guia não será pesquisada nem incluída automaticamente. Confirme se deseja criar apenas a parcela de ações ou registrar uma estratégia integralmente em ações.' : 'The system researches listed equities. The guide’s bond portion will not be researched or included automatically. Choose an equity sleeve or explicitly request a full-equity strategy.'}</p>
        <fieldset disabled={busy !== null}><legend>{pt ? 'Escopo da estratégia' : 'Strategy scope'}</legend>
          <label><input type="radio" name="creator-scope" value="equity_sleeve" checked={scope === 'equity_sleeve'} onChange={() => setScope('equity_sleeve')} disabled={assessment.suggestedAllocation.stocks === 0} />{pt ? 'Parcela de ações de uma carteira mais ampla' : 'Equity sleeve within a broader portfolio'}</label>
          <label><input type="radio" name="creator-scope" value="full_equity" checked={scope === 'full_equity'} onChange={() => setScope('full_equity')} />{pt ? 'Estratégia integralmente em ações, por minha escolha' : 'Full-equity strategy at my request'}</label>
        </fieldset>
        {assessment.suggestedAllocation.stocks === 0 && <p className="caveat">{pt ? 'O guia não sugere ações. Refaça o perfil ou explique expressamente sua decisão de divergir antes de continuar.' : 'The guide suggests no equities. Revisit the profile or explicitly explain your decision to depart from it before continuing.'}</p>}
        {scope === 'full_equity' && assessment.suggestedAllocation.stocks < 100 && <label>{pt ? 'Por que deseja divergir da composição sugerida? (mínimo 20 caracteres)' : 'Why depart from the suggested mix? (at least 20 characters)'}<textarea value={deviationReason} maxLength={1000} rows={3} onChange={event => setDeviationReason(event.target.value)} /></label>}
        <label><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />{pt ? 'Revisei as respostas, os alertas e o escopo. Entendo que o resultado é um guia geral e não aconselhamento completo.' : 'I reviewed the answers, warnings and scope. I understand the result is a general guide, not comprehensive investment advice.'}</label>
        <button className="action-button" type="button" disabled={busy !== null || !acknowledged || (scope === 'equity_sleeve' && assessment.suggestedAllocation.stocks === 0) || (scope === 'full_equity' && assessment.suggestedAllocation.stocks < 100 && deviationReason.trim().length < 20)} onClick={() => void action({ action: 'confirm_profile', confirmation: { scope, acknowledged: true, deviationReason } }, 'confirm')}>{pt ? 'Confirmar perfil e continuar' : 'Confirm profile and continue'}</button>
      </section>}
      {state && ['constraints', 'strategy_ready', 'document_ready'].includes(state.phase) && <div className="strategy-chat-transcript" ref={transcriptRef} aria-label={pt ? 'Conversa sobre a estratégia' : 'Strategy conversation'} aria-live="polite" aria-relevant="additions text">
        {state.messages.map((entry, index) => <article className={`strategy-chat-message ${entry.role}`} key={`${entry.role}-${index}`}><strong translate={entry.role === 'assistant' ? 'no' : undefined}>{entry.role === 'assistant' ? 'Portfolio Creator' : pt ? 'Você' : 'You'}</strong><p>{entry.content}</p></article>)}
      </div>}
      {busy && <p className="strategy-chat-status" role="status">{busy === 'pdf' ? (pt ? 'Gerando o PDF e salvando a revisão…' : 'Generating the PDF and saving the review…') : busy === 'thinking' ? (pt ? 'Portfolio Creator está elaborando a proposta com seu perfil confirmado e suas restrições…' : 'Portfolio Creator is preparing a proposal using your confirmed profile and constraints…') : (pt ? 'Salvando sua resposta…' : 'Saving your answer…')}</p>}
      {working && <div className="workflow-actions"><p role="status">{stalled ? (pt ? 'Esta resposta está demorando. Você pode interromper e tentar novamente.' : 'This turn is taking longer than expected. You can stop it and retry.') : (pt ? 'Aguardando a resposta do modelo. Nenhuma carteira foi criada.' : 'Waiting for the model response. No portfolio has been created.')}</p><button className="secondary-button" type="button" onClick={() => void cancelTurn()}>{pt ? 'Interromper resposta' : 'Stop this turn'}</button></div>}
      {state?.generationStatus === 'failed' && !working && <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => void send(undefined, true)}>{pt ? 'Tentar novamente com a resposta salva' : 'Retry the saved answer'}</button>}
      {state?.draft && ['strategy_ready', 'document_ready'].includes(state.phase) && <section className="strategy-chat-ready" aria-label={pt ? 'Estratégia pronta para revisão' : 'Strategy ready for review'}>
        <h3>{pt ? 'Proposta pronta para revisão' : 'Proposal ready for review'}</h3><p>{state.draft.purpose}</p><p className="note">{state.draft.markets.join(', ')} · {state.draft.timeHorizon} · {state.draft.riskTolerance}</p>
        <ul>{state.draft.mandates.map(mandate => <li key={mandate.role}><strong>{mandate.label}</strong> · {mandate.currency} — {mandate.objective}</li>)}</ul>
        <p className="note">{pt ? 'O PDF preservará o perfil, score, composição sugerida e escopo confirmado. A carteira só será criada na aprovação seguinte; depois começa a pesquisa.' : 'The PDF retains the profile, score, suggested mix and confirmed scope. Portfolio creation requires approval in the next review; research follows that approval.'}</p>
        <button className="action-button" type="button" onClick={() => void generatePdf()} disabled={busy !== null || working}>{state.phase === 'document_ready' ? (pt ? 'Abrir a revisão salva e baixar PDF' : 'Open saved review and download PDF') : (pt ? 'Gerar PDF da estratégia e revisar' : 'Generate strategy PDF and review')}</button>
      </section>}
      {!working && state?.phase !== 'profile_review' && state?.phase !== 'document_ready' && <form className="strategy-chat-composer" onSubmit={event => void send(event)}>
        <label htmlFor="portfolio-creator-message">{pt ? 'Sua resposta' : 'Your answer'}</label><textarea id="portfolio-creator-message" value={message} maxLength={4000} rows={3} disabled={busy !== null} placeholder={state?.phase === 'profiling' ? (pt ? 'Escolha uma alternativa acima ou digite A, B, C…' : 'Choose an option above or type A, B, C…') : (pt ? 'Descreva seu objetivo, mercados e restrições…' : 'Describe your objective, markets and constraints…')} onChange={event => setMessage(event.target.value)} />
        <button className="secondary-button" type="submit" disabled={busy !== null || !message.trim()}>{pt ? 'Enviar' : 'Send'}</button>
      </form>}
      {state && (answered > 0 || state.messages.length > 0) && !working && <div className="creator-reset">
        {resetRequested ? <><p>{pt ? 'Refazer o perfil apagará esta entrevista e a proposta não aprovada. Carteiras e teses aprovadas serão preservadas.' : 'Restarting clears this interview and its unapproved proposal. Approved portfolios and strategies are retained.'}</p><button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void action({ action: 'restart_profile' })}>{pt ? 'Confirmar reinício do perfil' : 'Confirm restart profiling'}</button><button type="button" className="secondary-button" onClick={() => setResetRequested(false)}>{pt ? 'Manter entrevista' : 'Keep interview'}</button></> : <button type="button" className="text-link" disabled={busy !== null} onClick={() => setResetRequested(true)}>{pt ? 'Refazer o perfil / nova estratégia' : 'Restart profiling / new strategy'}</button>}
      </div>}
    </>}
    {(error || state?.error) && <div className="caveat" role="alert"><p>{error || state?.error}</p>{saved && <button className="secondary-button" type="button" onClick={() => void load().catch(cause => setError(cause.message))}>{pt ? 'Recarregar entrevista salva' : 'Reload saved interview'}</button>}</div>}
  </section>;
}
