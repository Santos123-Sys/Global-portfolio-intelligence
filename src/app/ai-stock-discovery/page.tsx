'use client';

import type { DiscoveryEvidenceScorecard } from '@/lib/discovery-evidence';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { DiscoveryCandidate as ContractCandidate, MarketBrief, MarketDiscoveryOutput } from '@portfolio-intelligence/agentic-contract';
import { MarketAnalysisReview } from '@/components/market-analysis-review';
import type { MarketAnalysis } from '@portfolio-intelligence/agentic-contract';
import { DiscoveryScreeningReview, DiscoveryCandidateContext } from '@/components/discovery-screening-review';
import { useCallback, useEffect, useState } from 'react';
const ValuationWorkbench = dynamic(() => import('@/components/valuation-workbench').then(module => module.ValuationWorkbench), {
  loading: () => <p className="note" role="status">Loading valuation tools…</p>,
});
import { ResearchWorkspace } from '@/components/research-workspace';
import { useLanguage } from '@/lib/i18n';
import { discoveryDate, discoveryText } from '@/lib/discovery-translations';
import { decisionJournalSchema } from '@/lib/decision-journal';
import { MarketBriefReview } from '@/components/market-brief-review';

interface DiscoveryRun {
  id: string;
  externalDiscoveryId: string;
  status: string;
  progress?: { completed: number; total: number; currentStage: string };
  provider: string;
  requestedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  candidateCount: number;
  maxCandidatesPerPortfolio: number | null;
  portfolioCandidateCounts: Array<{
    portfolioId: string;
    portfolioName: string;
    count: number;
    status: 'candidates_found' | 'no_candidates' | 'failed' | 'pending';
    reason: string;
  }>;
  universeCoverage?: {
    records: number;
    truncated: boolean;
    unranked: boolean;
    providers: string[];
    recordsByPortfolio: Array<{ portfolioId: string; count: number }>;
  };
  /**
   * The full agent output. It was already being returned by the runs API and
   * simply never read: a run that completed with zero candidates showed
   * "Issue: —", while the agent's own account of why it found nothing sat in
   * this field. An empty result with no stated reason is worse than a failure,
   * because there is nothing to act on.
   */
  resultJson: {
    thesisVersion?: number;
    screeningAudit?: MarketDiscoveryOutput['screeningAudit'];
    limitations?: string[];
    marketMandates?: Array<{ portfolioId: string; rationale: string }>;
  } | null;
}

interface RiskMetric {
  metricName: string;
  value: number;
  methodology: string;
  caveat: string | null;
}

interface ResearchFramework {
  coverageRationale: string;
  marketContext: string[];
  sectorDrivers: string[];
  companyDrivers: string[];
  criticalValuationDrivers: string[];
  monitoringTriggers: string[];
  evidenceQuality: 'limited' | 'developing' | 'sufficient';
  scenarioReadiness: 'not_ready' | 'qualitative_only' | 'driver_ready';
}

interface Candidate {
  id: string;
  runId: string;
  ticker: string;
  exchange: string;
  companyName: string;
  currency: string;
  country: string | null;
  sector: string | null;
  industry: string | null;
  classificationSource: 'provider' | 'web_research' | 'unclassified';
  portfolioName: string;
  decision: string;
  workflowStatus: string;
  externalAnalysisRunId: string | null;
  externalMarketBriefId: string | null;
  marketBriefStatus: string;
  marketBriefJson: MarketBrief | null;
  marketBriefErrorMessage: string | null;
  analysisRunStatus: string | null;
  analysisRunError: string | null;
  analysisErrorMessage: string | null;
  reportUrl: string | null;
  analysisMode: 'full_fundamentals' | 'limited_research_risk' | null;
  dcfLocked: boolean;
  dcfLockReason: string | null;
  latestPrice: {
    close: number;
    currency: string;
    asOf: string;
    provider: string;
    sourceUrl: string | null;
  } | null;
  decisionJournal: DecisionJournalDraft | null;
  evidenceScorecard: DiscoveryEvidenceScorecard;
  discoveryJson: {
    discoveryContext?: ContractCandidate['discoveryContext'];
    thesisAlignmentScore: number;
    rationale: string;
    matchedCriteria: string[];
    violatedCriteria: string[];
    informationGaps: string[];
    groundedIn: string[];
    sourceUrls: string[];
  };
  risk: RiskMetric[] | null;
  analysis: {
    investmentScore: number;
    thesisAlignmentScore: number;
    qualityScore: number | null;
    growthScore: number | null;
    riskScore: number | null;
    dividendScore: number | null;
    confidenceScore: number;
    fundamentalSummary: string | null;
    investmentThesis: string | null;
    keyCatalysts: string[] | null;
    keyRisks: string[] | null;
    thesisBreakers: string[] | null;
    marketAnalysis?: MarketAnalysis | null;
    researchFramework: ResearchFramework | null;
    groundedIn: string[] | null;
    informationGaps: string[] | null;
  } | null;
  valuation: { resultJson: { currency: string; fairValuePerShare?: number } } | null;
}

interface DecisionJournalDraft {
  decisionReason: string;
  expectedHoldingPeriod: string;
  valuationView: string;
  principalRisk: string;
  invalidationTrigger: string;
}

interface DiscoveryPreflight {
  ready: boolean;
  checkedAt: string;
  provider: string | null;
  checks: Array<{ label: string; detail: string; status: 'ready' | 'blocked' | 'warning' }>;
}

const emptyDecisionJournal = (): DecisionJournalDraft => ({
  decisionReason: '',
  expectedHoldingPeriod: '',
  valuationView: '',
  principalRisk: '',
  invalidationTrigger: '',
});

function journalIsComplete(journal: DecisionJournalDraft): boolean {
  return decisionJournalSchema.safeParse(journal).success;
}

function invalidJournalFields(journal: DecisionJournalDraft): Array<keyof DecisionJournalDraft> {
  const result = decisionJournalSchema.safeParse(journal);
  if (result.success) return [];
  return [...new Set(result.error.issues.map((issue) => issue.path[0] as keyof DecisionJournalDraft))];
}

function journalFieldLabels(t: (key: Parameters<typeof discoveryText>[1]) => string): Record<keyof DecisionJournalDraft, string> {
  return {
    decisionReason: t('why'), expectedHoldingPeriod: t('period'), valuationView: t('valuation'),
    principalRisk: t('principalRisk'), invalidationTrigger: t('invalidation'),
  };
}

function friendlyAnalysisStatus(candidate: Candidate, t: (key: Parameters<typeof discoveryText>[1]) => string): {
  label: string;
  badgeClass: 'ok' | 'watch' | 'breach';
  description: string;
} {
  if (candidate.workflowStatus === 'analysis_failed' || candidate.analysisRunStatus === 'failed') {
    return {
      label: t('attention'),
      badgeClass: 'breach',
      description: t('attentionDetail'),
    };
  }
  if (candidate.reportUrl || (candidate.analysis && (candidate.analysisRunStatus === 'completed' || candidate.analysisRunStatus === 'imported'))) {
    return {
      label: t('reportReady'),
      badgeClass: 'ok',
      description: t('reportReadyDetail'),
    };
  }
  if (candidate.analysisRunStatus === 'running') {
    return {
      label: t('inProgress'),
      badgeClass: 'watch',
      description: t('inProgressDetail'),
    };
  }
  if (candidate.workflowStatus === 'analysis_preparing') {
    return {
      label: t('evidencePreparing'),
      badgeClass: 'watch',
      description: t('evidencePreparingDetail'),
    };
  }
  return {
    label: t('waiting'),
    badgeClass: 'watch',
    description: t('waitingDetail'),
  };
}

function friendlyRiskMetric(metricName: string): string {
  const labels: Record<string, string> = {
    Volatility: 'Annualized volatility',
    MaxDrawdown: 'Maximum drawdown',
    VaR_95_1d_Historical: '1-day VaR (historical, 95%)',
    VaR_95_1d_Parametric: '1-day VaR (parametric, 95%)',
  };
  return labels[metricName] ?? metricName.replaceAll('_', ' ');
}

function frameworkLabel(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatLatestPrice(price: Candidate['latestPrice']): string | null {
  if (!price) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: price.currency,
      maximumFractionDigits: 2,
    }).format(price.close);
  } catch {
    return `${price.currency} ${price.close.toFixed(2)}`;
  }
}

export default function AIStockDiscoveryPage() {
  const { language } = useLanguage();
  const t = (key: Parameters<typeof discoveryText>[1]) => discoveryText(language, key);
  const date = (value: string) => discoveryDate(language, value);
  const [runs, setRuns] = useState<DiscoveryRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidatePortfolio, setCandidatePortfolio] = useState('all');
  const [candidateFilter, setCandidateFilter] = useState<'all' | 'pending' | 'approved'>('all');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [candidateListLoading, setCandidateListLoading] = useState(false);
  const [candidateLimit, setCandidateLimit] = useState('6');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidateErrors, setCandidateErrors] = useState<Record<string, string>>({});
  const [valuationCandidateId, setValuationCandidateId] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<DiscoveryPreflight | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [journalDrafts, setJournalDrafts] = useState<Record<string, DecisionJournalDraft>>({});

  const loadRuns = useCallback(async (signal?: AbortSignal) => {
    const runResponse = await fetch('/api/discovery/runs', { signal });
    const runBody = await runResponse.json().catch(() => ({})) as { runs?: DiscoveryRun[]; error?: string };
    if (!runResponse.ok) throw new Error(runBody.error ?? `Discovery runs failed (${runResponse.status})`);
    if (!signal?.aborted) { setRuns(runBody.runs ?? []); setRunsLoading(false); }
  }, []);

  const loadCandidates = useCallback(async (runId: string, signal?: AbortSignal) => {
    const response = await fetch(`/api/discovery/candidates?runId=${encodeURIComponent(runId)}`, { signal });
    const body = await response.json().catch(() => ({})) as { candidates?: Candidate[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? `Candidates failed (${response.status})`);
    if (!signal?.aborted) setCandidates(body.candidates ?? []);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadRuns(controller.signal).catch((cause) => {
      if (!controller.signal.aborted) { setError((cause as Error).message); setRunsLoading(false); }
    });
    return () => controller.abort();
  }, [loadRuns]);

  useEffect(() => {
    if (!selectedRunId) {
      setCandidates([]);
      setCandidateListLoading(false);
      return;
    }
    const controller = new AbortController();
    setCandidateListLoading(true);
    setCandidates([]);
    void loadCandidates(selectedRunId, controller.signal)
      .catch((cause) => {
        if (!controller.signal.aborted) setError((cause as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCandidateListLoading(false);
      });
    return () => controller.abort();
  }, [loadCandidates, selectedRunId]);

  const hasActiveWork =
    runs.some((run) => run.status === 'dispatching' || run.status === 'queued' || run.status === 'running') ||
    candidates.some((candidate) =>
      candidate.workflowStatus === 'market_research_preparing' ||
      candidate.workflowStatus === 'market_research_dispatching' ||
      candidate.workflowStatus === 'analysis_preparing' ||
      ['dispatching', 'queued', 'running'].includes(candidate.marketBriefStatus) ||
      candidate.analysisRunStatus === 'queued' ||
      candidate.analysisRunStatus === 'running'
    );

  useEffect(() => {
    if (!hasActiveWork) return;
    const controller = new AbortController();
    const interval = window.setInterval(() => {
      void Promise.all([
        loadRuns(controller.signal),
        selectedRunId ? loadCandidates(selectedRunId, controller.signal) : Promise.resolve(),
      ]).catch(() => undefined);
    }, 4_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [hasActiveWork, loadCandidates, loadRuns, selectedRunId]);

  async function fetchDiscoveryReadiness() {
    setPreflight(null);
    const response = await fetch('/api/discovery/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ maxCandidatesPerPortfolio: Number(candidateLimit) }),
    });
    const body = await response.json().catch(() => ({})) as { preflight?: DiscoveryPreflight; error?: string };
    if (!body.preflight) throw new Error(body.error ?? `Readiness check failed (${response.status})`);
    setPreflight(body.preflight);
  }

  async function checkDiscoveryReadiness() {
    setPreflightBusy(true);
    setError(null);
    try {
      await fetchDiscoveryReadiness();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPreflightBusy(false);
    }
  }

  async function startDiscovery() {
    setBusy('start');
    setError(null);
    setSelectedRunId(null);
    setCandidates([]);
    try {
      const response = await fetch('/api/discovery/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxCandidatesPerPortfolio: Number(candidateLimit) }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Discovery start failed (${response.status})`);
      setPreflight(null);
      await loadRuns();
    } catch (cause) {
      setError((cause as Error).message);
      // A failed start should explain the specific missing requirement in place.
      await fetchDiscoveryReadiness().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  function journalFor(candidate: Candidate): DecisionJournalDraft {
    return journalDrafts[candidate.id] ?? candidate.decisionJournal ?? emptyDecisionJournal();
  }

  function updateJournal(candidate: Candidate, field: keyof DecisionJournalDraft, value: string) {
    setJournalDrafts((current) => ({
      ...current,
      [candidate.id]: { ...(current[candidate.id] ?? candidate.decisionJournal ?? emptyDecisionJournal()), [field]: value },
    }));
    setCandidateErrors((current) => {
      if (!current[candidate.id]) return current;
      const next = { ...current };
      delete next[candidate.id];
      return next;
    });
  }

  async function decide(candidate: Candidate, decision: 'approved' | 'rejected' | 'watchlist') {
    const candidateId = candidate.id;
    const journal = journalFor(candidate);
    if (decision === 'approved' && !journalIsComplete(journal)) {
      const labels = journalFieldLabels(t);
      const message = `${t('journalIncomplete')} ${invalidJournalFields(journal).map((field) => labels[field]).join(', ')}.`;
      setCandidateErrors((current) => ({ ...current, [candidateId]: message }));
      return;
    }
    setBusy(candidateId);
    setError(null);
    setCandidateErrors((current) => {
      const next = { ...current };
      delete next[candidateId];
      return next;
    });
    try {
      const response = await fetch('/api/discovery/candidates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateId, decision, journal: journalIsComplete(journal) ? journal : undefined }),
      });
      const body = await response.json().catch(() => ({})) as { candidate?: Partial<Candidate> & { id: string }; error?: string };
      if (!response.ok) throw new Error(body.error ?? `Candidate decision failed (${response.status})`);
      if (decision === 'rejected') {
        // Rejected candidates are intentionally removed from the active
        // review list immediately. They remain auditable in Research history.
        setCandidates((current) => current.filter((candidate) => candidate.id !== candidateId));
      } else if (body.candidate) {
        setCandidates((current) => current.map((candidate) =>
          candidate.id === candidateId ? { ...candidate, ...body.candidate } : candidate
        ));
      }
      if (selectedRunId) await loadCandidates(selectedRunId);
    } catch (cause) {
      const message = (cause as Error).message;
      setError(message);
      setCandidateErrors((current) => ({ ...current, [candidateId]: message }));
    } finally {
      setBusy(null);
    }
  }

  async function retryAnalysis(externalRunId: string) {
    setBusy(`analysis:${externalRunId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/integrations/agentic/runs?externalRunId=${encodeURIComponent(externalRunId)}`,
        { method: 'PATCH' }
      );
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Analysis retry failed (${response.status})`);
      if (selectedRunId) await loadCandidates(selectedRunId);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function marketBriefAction(candidate: Candidate, action: 'approve_and_analyze' | 'retry') {
    setBusy(`market-brief:${candidate.id}`);
    setError(null);
    try {
      const response = await fetch('/api/discovery/market-brief', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateId: candidate.id, action }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Market brief action failed (${response.status})`);
      if (selectedRunId) await loadCandidates(selectedRunId);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(null); }
  }

  function toggleCandidateReview(runId: string) {
    setError(null);
    setCandidateErrors({});
    setValuationCandidateId(null);
    setExpandedCandidateId(null); setCandidateQuery(''); setCandidatePortfolio('all'); setCandidateFilter('all');
    setSelectedRunId((current) => current === runId ? null : runId);
  }

  const latestRun = runs[0] ?? null;
  const discoveryRunning = runs.some(run => ['dispatching', 'queued', 'running'].includes(run.status));
  const visibleCandidates = candidates.filter(candidate =>
    (candidatePortfolio === 'all' || candidate.portfolioName === candidatePortfolio) &&
    (candidateFilter === 'all' || (candidateFilter === 'pending' ? ['pending', 'watchlist'].includes(candidate.decision) : candidate.decision === 'approved')) &&
    `${candidate.companyName} ${candidate.ticker}`.toLocaleLowerCase().includes(candidateQuery.trim().toLocaleLowerCase())
  );
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;

  return (
    <main>
      <section className="dashboard-hero animate-fade-in">
        <h1 className="text-glow">{t('title')}</h1>
        <p className="hero-lead">{t('intro')}</p>
      </section>

      {error && <div className="login-error workflow-error" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={() => void loadRuns().then(() => setError(null)).catch(cause => setError(cause.message))}>Retry loading</button></div>}
      <aside className="workflow-next-action card" aria-live="polite"><strong>{t('nextAction')}</strong><p>{runsLoading ? t('loadingRuns') : discoveryRunning ? t('researchInProgress') : latestRun?.status === 'completed' && latestRun.candidateCount > 0 ? t('nextReview') : t('nextSearch')}</p><Link className="text-link" href="/investment-thesis">{t('thesisLink')}</Link></aside>

      <section className="card glow-card workflow-stage">
        <div>
          <h2>{t('start')}</h2>
          <p className="note">{t('startDetail')}</p>
        </div>
        <details className="discovery-search-options"><summary>{t('searchOptions')}</summary><label className="compact-field">{t('limit')}
          <input type="number" min="1" max="7" value={candidateLimit} onChange={(event) => { setCandidateLimit(event.target.value); setPreflight(null); }} />
          <span>{t('limitDetail')}</span>
        </label></details>
        <div className="discovery-actions">
          <button className="secondary-button" type="button" onClick={() => void checkDiscoveryReadiness()} disabled={busy !== null || preflightBusy}>
            {preflightBusy ? t('checking') : t('check')}
          </button>
          <button className="action-button" type="button" onClick={() => void startDiscovery()} disabled={busy !== null || preflightBusy || runsLoading || discoveryRunning}>
            {busy === 'start' ? t('starting') : t('find')}
          </button>
        </div>
      </section>

      {preflight && <section className={`card discovery-preflight ${preflight.ready ? 'preflight-ready' : 'preflight-blocked'}`} aria-live="polite">
        <div className="section-heading">
          <div>
            <h2>{preflight.ready ? t('ready') : t('blocked')}</h2>
            <p className="note">{t('checked')} {date(preflight.checkedAt)}{preflight.provider ? ` · ${t('provider')}: ${preflight.provider}` : ''}</p>
          </div>
          <span className={`badge ${preflight.ready ? 'ok' : 'breach'}`}>{preflight.ready ? t('readyBadge') : t('blockedBadge')}</span>
        </div>
        <div className="preflight-checks">
          {preflight.checks.map((check) => <div key={`${check.status}:${check.label}`}>
            <strong>{check.label}</strong>
            <p>{check.detail}</p>
            {check.status === 'blocked' && /thesis|portfolio mandate/i.test(`${check.label} ${check.detail}`) && <Link className="text-link" href="/investment-thesis">Review investment thesis</Link>}
          </div>)}
        </div>
      </section>}

      <section className="card glow-card">
        <div className="section-heading">
          <div>
            <h2>{t('latest')}</h2>
            <p className="note">{t('latestDetail')}</p>
          </div>
          <Link className="secondary-button inline-action" href="/research-history">{t('history')}</Link>
        </div>
        {runsLoading ? <p className="note" role="status">{t('loadingRuns')}</p> : runs.length === 0 ? <p className="note">{t('noRuns')}</p> : (
          <div className="latest-run-summary" aria-live="polite">
            <p>
              <strong>{t('latestRun')}:</strong> {date(latestRun!.requestedAt)} ·{' '}
              <span className={`badge ${latestRun!.status === 'failed' ? 'breach' : latestRun!.status === 'completed' ? 'ok' : 'watch'}`}>{t(latestRun!.status === 'failed' ? 'failed' : latestRun!.status === 'completed' ? 'completed' : latestRun!.status === 'running' ? 'running' : 'queued')}</span>{' '}
              · {latestRun!.candidateCount} {t('candidates')}
            </p>
            {latestRun!.status === 'dispatching' && <p role="status">Request saved. Confirming delivery; retries reuse this run.</p>}
            {latestRun!.resultJson?.thesisVersion && <p>Approved thesis version {latestRun!.resultJson.thesisVersion}</p>}
            {latestRun!.progress && latestRun!.status !== 'completed' && <p role="status">{latestRun!.progress.currentStage} · {latestRun!.progress.completed}/{latestRun!.progress.total} stages</p>}
            <div className="preflight-checks" aria-label="Research outcome by portfolio">
              {latestRun!.portfolioCandidateCounts.map((portfolio) => <div key={portfolio.portfolioId}>
                <strong>{portfolio.portfolioName}</strong>
                <p>{portfolio.count} candidates · {portfolio.status === 'failed' ? 'Research failed' : portfolio.status === 'no_candidates' ? 'No matches' : portfolio.status === 'pending' ? 'Research pending' : 'Research completed'}</p>
                <p>{portfolio.status === 'no_candidates'
                  ? 'No companies cleared the mandate evidence threshold in this run.'
                  : portfolio.reason.length > 220 ? `${portfolio.reason.slice(0, 220).trimEnd()}…` : portfolio.reason}</p>
                {portfolio.reason.length > 220 && <details className="run-outcome-details">
                  <summary>Read the full research explanation</summary>
                  <p>{portfolio.reason}</p>
                </details>}
                {latestRun!.universeCoverage &&
                  (latestRun!.universeCoverage.truncated || latestRun!.universeCoverage.unranked) && <p className="run-coverage-warning">
                    This result covers {latestRun!.universeCoverage.recordsByPortfolio.find((item) => item.portfolioId === portfolio.portfolioId)?.count ?? 0} supplied records
                    {latestRun!.universeCoverage.providers.length ? ` from ${latestRun!.universeCoverage.providers.join(', ')}` : ''}.
                    {latestRun!.universeCoverage.truncated ? ' The list was truncated' : ''}
                    {latestRun!.universeCoverage.truncated && latestRun!.universeCoverage.unranked ? ' and' : ''}
                    {latestRun!.universeCoverage.unranked ? ' not ranked' : ''}; this shortlist does not represent a ranked search of the full market. Missing matches do not establish market-wide ineligibility.
                  </p>}
              </div>)}
            </div>
            <DiscoveryScreeningReview audit={latestRun!.resultJson?.screeningAudit} portfolios={latestRun!.portfolioCandidateCounts} />
            {!!latestRun!.resultJson?.limitations?.length && <details className="run-outcome-details">
              <summary>{t('researchLimits')}</summary>
              <ul>{latestRun!.resultJson.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>
            </details>}
            {latestRun!.status === 'completed' && latestRun!.candidateCount > 0 && <button
              className="action-button"
              type="button"
              onClick={() => toggleCandidateReview(latestRun!.id)}
            >
              {selectedRunId === latestRun!.id ? t('hide') : t('reviewLatest')}
            </button>}
          </div>
        )}
      </section>

      <section id="candidate-review" className="candidate-review-section">
        <div className="section-heading candidate-review-heading">
          <div>
            <h2 className="section-title">{t('review')}</h2>
            {selectedRun && <p className="note">{t('showing')} {date(selectedRun.requestedAt)}. {t('rejected')}</p>}
          </div>
          {selectedRunId && <button className="action-button" type="button" onClick={() => setSelectedRunId(null)}>{t('hide')}</button>}
        </div>
        {!selectedRunId ? <div className="card"><p className="note">{t('hidden')}</p></div>
          : candidateListLoading ? <div className="card"><p className="note">{t('loading')}</p></div>
          : candidates.length === 0 ? <div className="card"><p className="note">{t('empty')}</p></div> : (
          <div>
            <div className="workflow-filter-bar">
              <label>{t('searchCandidates')}<input type="search" value={candidateQuery} onChange={event => setCandidateQuery(event.target.value)} /></label>
              <label>{t('portfolioFilter')}<select aria-label={t('portfolioFilter')} value={candidatePortfolio} onChange={event => setCandidatePortfolio(event.target.value)}><option value="all">{t('allPortfolios')}</option>{[...new Set(candidates.map(candidate => candidate.portfolioName))].map(name => <option key={name} value={name}>{name}</option>)}</select></label>
              <label>{t('reviewStatus')}<select aria-label={t('reviewStatus')} value={candidateFilter} onChange={event => setCandidateFilter(event.target.value as typeof candidateFilter)}><option value="all">{t('allCandidates')}</option><option value="pending">{t('awaitingDecision')}</option><option value="approved">{t('approved')}</option></select></label>
            </div>
            <p className="note" role="status">{visibleCandidates.length} / {candidates.length} {t('candidates')}</p>
            {visibleCandidates.length === 0 && <p className="note">{t('noFilterMatches')}</p>}
          <div className="candidate-list">{visibleCandidates.map((candidate) => {
            const discovery = candidate.discoveryJson;
            const canDecide = candidate.decision === 'pending' || candidate.decision === 'watchlist';
            const isWorking = busy === candidate.id;
            const analysisStatus = friendlyAnalysisStatus(candidate, t);
            const journal = journalFor(candidate);
            const invalidFields = invalidJournalFields(journal);
            const fieldLabels = journalFieldLabels(t);
            return <article className="card glow-card candidate-card" key={candidate.id}>
              <div className="candidate-heading">
                <div>
                  <h3>{candidate.companyName} <span className="note">{candidate.ticker} · {candidate.exchange}</span></h3>
                  <p className="note">{candidate.portfolioName} · {candidate.country ?? t('countryUnknown')} · {candidate.sector ?? t('sectorUnknown')} · {candidate.industry ?? t('industryUnknown')} · {candidate.currency}</p>
                  <p className="note">{t('classification')}: {candidate.classificationSource === 'provider' ? t('providerClass') : candidate.classificationSource === 'web_research' ? t('webClass') : t('unclassified')}</p>
                </div>
                <div className="candidate-score"><span>Thesis fit</span><span>Review reasons below</span></div>
              </div>
              <p>{discovery.rationale}</p>
              <div className="candidate-scan-summary"><span className={`badge ${candidate.decision === 'approved' ? 'ok' : 'watch'}`}>{candidate.decision === 'approved' ? t('approved') : candidate.decision === 'watchlist' ? t('watchlist') : t('pending')}</span><span>{discovery.sourceUrls.length} {t('sources')} · {discovery.informationGaps.length} {t('gaps')}</span>{discovery.violatedCriteria.length > 0 && <span className="caveat">{discovery.violatedCriteria.length} {t('conflicts')}</span>}</div>
              <details className="candidate-detail-panel" open={expandedCandidateId === candidate.id} onToggle={event => {
                const open = event.currentTarget.open;
                setExpandedCandidateId(current => open ? candidate.id : current === candidate.id ? null : current);
              }}>
              <summary>{t('reviewCompany')}</summary>
              <DiscoveryCandidateContext context={discovery.discoveryContext} />
              {candidate.latestPrice && <p className="note"><strong>{t('close')}:</strong> {formatLatestPrice(candidate.latestPrice)} · {t('asOf')} {candidate.latestPrice.asOf} · {candidate.latestPrice.provider}</p>}
              <section className="evidence-scorecard" aria-label={t('evidence')}>
                <div className="evidence-scorecard-heading">
                  <strong>{t('evidence')}</strong>
                  <span className={`badge ${candidate.evidenceScorecard.assessment === 'developing' ? 'watch' : 'breach'}`}>
                    {t(candidate.evidenceScorecard.assessment)}
                  </span>
                </div>
                <div className="evidence-scorecard-grid">
                  <span>{candidate.evidenceScorecard.sourceUrlCount} {t('sources')}</span>
                  <span>{candidate.evidenceScorecard.groundingFieldCount} {t('facts')}</span>
                  <span>{candidate.evidenceScorecard.informationGapCount} {t('gaps')}</span>
                  <span>{t('price')} {t(candidate.evidenceScorecard.marketPriceStatus)}</span>
                  <span>{candidate.evidenceScorecard.conflictCount} {t('conflicts')}</span>
                </div>
                <p>{t(candidate.evidenceScorecard.assessment === 'developing' ? 'developingDetail' : 'limitedDetail')}</p>
                {candidate.decision !== 'approved' && <p className="note">{t('continueResearch')}</p>}
                {candidate.decision === 'approved' && <p className="note">{t('snapshotDetail')}</p>}
              </section>
              <p className="note"><strong>{t('matched')}:</strong> {discovery.matchedCriteria.join(' · ') || t('none')}</p>
              {discovery.violatedCriteria.length > 0 && <p className="caveat"><strong>{t('conflicts')}:</strong> {discovery.violatedCriteria.join(' · ')}</p>}
              {discovery.informationGaps.length > 0 && <p className="note"><strong>{t('gapList')}:</strong> {discovery.informationGaps.join(' · ')}</p>}
              <p className="note"><strong>{t('sourceList')}:</strong> {discovery.sourceUrls.map((url, index) => <span key={url}>{index ? ' · ' : ''}<a className="text-link" href={url} target="_blank" rel="noreferrer">{t('source')} {index + 1}</a></span>)}</p>
              {canDecide && <details className="decision-journal" open>
                <summary>{t('journal')} <span>{t('required')}</span></summary>
                <p>{t('journalDetail')}</p>
                <div className="decision-journal-grid">
                  <label>{t('why')}
                    <textarea value={journal.decisionReason} onChange={(event) => updateJournal(candidate, 'decisionReason', event.target.value)} placeholder="Specific reason this opportunity merits deeper work" />
                  </label>
                  <label>{t('period')}
                    <input value={journal.expectedHoldingPeriod} onChange={(event) => updateJournal(candidate, 'expectedHoldingPeriod', event.target.value)} placeholder="e.g. 3–5 years" />
                  </label>
                  <label>{t('valuation')}
                    <textarea value={journal.valuationView} onChange={(event) => updateJournal(candidate, 'valuationView', event.target.value)} placeholder="What must be tested in valuation and why" />
                  </label>
                  <label>{t('principalRisk')}
                    <textarea value={journal.principalRisk} onChange={(event) => updateJournal(candidate, 'principalRisk', event.target.value)} placeholder="Most material downside risk" />
                  </label>
                  <label>{t('invalidation')}
                    <textarea value={journal.invalidationTrigger} onChange={(event) => updateJournal(candidate, 'invalidationTrigger', event.target.value)} placeholder="Observable trigger that would change the decision" />
                  </label>
                </div>
                <p className="journal-feedback" role="status">{invalidFields.length === 0
                  ? t('journalReady')
                  : `${t('journalIncomplete')} ${invalidFields.map((field) => fieldLabels[field]).join(', ')}.`}</p>
              </details>}
              <div className="candidate-actions">
                <span className={`badge ${candidate.decision === 'rejected' ? 'breach' : candidate.decision === 'approved' ? 'ok' : 'watch'}`}>{candidate.decision === 'watchlist' ? t('watchlist') : candidate.decision === 'rejected' ? t('reject') : candidate.decision === 'approved' ? t('approved') : t('pending')}</span>
                {canDecide && <>
                  <button className="approve-action" type="button" onClick={() => void decide(candidate, 'approved')} disabled={isWorking}>{isWorking ? t('approving') : t('approve')}</button>
                  <button type="button" onClick={() => void decide(candidate, 'watchlist')} disabled={isWorking}>{t('watchlist')}</button>
                  <button type="button" className="danger-outline" onClick={() => void decide(candidate, 'rejected')} disabled={isWorking}>{t('reject')}</button>
                </>}
                {isWorking && <span className="note">{t('preparing')}</span>}
                {candidateErrors[candidate.id] && <p className="caveat" role="alert">{candidateErrors[candidate.id]}</p>}
              </div>

              {candidate.decision === 'approved' && (
                <div className="analysis-stage">
                  <div className="analysis-stage-heading">
                    <div>
                      <p className="analysis-eyebrow">Approved investment research</p>
                      <h3>{t('analysis')}</h3>
                    </div>
                    <span className={`badge ${analysisStatus.badgeClass}`}>{analysisStatus.label}</span>
                  </div>
                  <p className="analysis-status-copy" aria-live="polite">{analysisStatus.description}</p>
                  {candidate.marketBriefStatus !== 'completed' && candidate.workflowStatus.startsWith('market_research') && <section className="market-brief-review" aria-live="polite">
                    <p className="analysis-eyebrow">Top-down market research</p>
                    <h3>{candidate.marketBriefStatus === 'dispatching' || candidate.marketBriefStatus === 'queued' || candidate.marketBriefStatus === 'running'
                      ? 'Preparing market brief' : candidate.marketBriefStatus === 'failed' ? 'Market research needs attention' : 'Market brief not started'}</h3>
                    {(candidate.marketBriefStatus === 'dispatching' || candidate.marketBriefStatus === 'queued' || candidate.marketBriefStatus === 'running')
                      ? <p className="note">{candidate.marketBriefStatus === 'running' ? 'Research is in progress; this view updates automatically.' : 'The research request is being delivered to the durable agentic worker.'}</p>
                      : candidate.marketBriefErrorMessage && <p className="caveat" role="alert">{candidate.marketBriefErrorMessage}</p>}
                    {candidate.marketBriefStatus === 'failed' && <button className="action-button" type="button" disabled={busy !== null} onClick={() => void marketBriefAction(candidate, 'retry')}>
                      {busy === `market-brief:${candidate.id}` ? 'Retrying market research…' : 'Retry market research'}
                    </button>}
                  </section>}
                  {candidate.marketBriefStatus === 'completed' && candidate.marketBriefJson && <MarketBriefReview
                    brief={candidate.marketBriefJson}
                    busy={busy === `market-brief:${candidate.id}`}
                    onApprove={() => void marketBriefAction(candidate, 'approve_and_analyze')}
                  />}
                  {candidate.analysisMode === 'limited_research_risk' && <div className="analysis-scope">
                    <strong>{t('scope')}</strong>
                    <p>{t('scopeDetail')}</p>
                  </div>}
                  <ResearchWorkspace candidate={{
                    companyName: candidate.companyName, runStatus: selectedRun?.status ?? 'completed',
                    decision: candidate.decision, workflowStatus: candidate.workflowStatus,
                    analysisRunStatus: candidate.analysisRunStatus, risk: candidate.risk,
                    analysis: candidate.analysis, sourceUrls: candidate.discoveryJson.sourceUrls,
                  }} onOpenReport={() => {
                    setValuationCandidateId(candidate.id);
                    window.setTimeout(() => document.getElementById(`financial-report-${candidate.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
                  }} />
                  {candidate.workflowStatus === 'analysis_failed' && <p className="caveat" role="alert">{candidate.analysisErrorMessage ?? candidate.analysisRunError ?? 'Analysis failed. Retry from this candidate card.'}</p>}
                  {candidate.workflowStatus === 'analysis_failed' && !candidate.externalAnalysisRunId && <button className="action-button" type="button" onClick={() => void decide(candidate, 'approved')} disabled={busy !== null || !journalIsComplete(journalFor(candidate))}>
                    {busy === candidate.id ? 'Retrying preparation…' : t('retryPreparation')}
                  </button>}
                  {candidate.analysisRunStatus === 'failed' && candidate.externalAnalysisRunId && <button className="action-button" type="button" onClick={() => void retryAnalysis(candidate.externalAnalysisRunId!)} disabled={busy !== null}>
                    {busy === `analysis:${candidate.externalAnalysisRunId}` ? 'Retrying analysis…' : t('retryAnalysis')}
                  </button>}
                  {candidate.risk && <div className="risk-strip">{candidate.risk.map((metric) => <div key={metric.metricName}>
                    <span>{friendlyRiskMetric(metric.metricName)}</span><strong>{(metric.value * 100).toFixed(2)}%</strong>
                    <details><summary>{t('calculation')}</summary><p>{metric.methodology}</p>{metric.caveat && <p className="caveat">{metric.caveat}</p>}</details>
                  </div>)}</div>}
                  {candidate.analysis ? <>
                    <div className="analysis-score-summary">
                      <div><strong>{candidate.analysis.investmentScore}</strong><span>{t('investmentScore')}</span></div>
                      <div><strong>{candidate.analysis.thesisAlignmentScore}</strong><span>{t('alignment')}</span></div>
                      <div><strong>{(candidate.analysis.confidenceScore * 100).toFixed(0)}%</strong><span>{t('confidence')}</span></div>
                    </div>
                    {candidate.analysisMode === 'limited_research_risk'
                      ? <p className="note">Risk severity {candidate.analysis.riskScore ?? '—'} · Financial characteristic scores are withheld in limited-data mode.</p>
                      : <p className="note">Quality {candidate.analysis.qualityScore ?? '—'} · Growth {candidate.analysis.growthScore ?? '—'} · Risk severity {candidate.analysis.riskScore ?? '—'} · Dividend {candidate.analysis.dividendScore ?? '—'}</p>}
                    <div className="analysis-decision">
                      <h4>{t('decisionView')}</h4>
                      <p>{candidate.analysis.investmentThesis}</p>
                    </div>
                    <p><strong>{t('coverage')}:</strong> {candidate.analysis.fundamentalSummary}</p>
                    <p className="note"><strong>{t('catalysts')}:</strong> {(candidate.analysis.keyCatalysts ?? []).join(' · ')}</p>
                    <p className="caveat"><strong>{t('risks')}:</strong> {(candidate.analysis.keyRisks ?? []).join(' · ')}</p>
                    <p className="caveat"><strong>{t('breakers')}:</strong> {(candidate.analysis.thesisBreakers ?? []).join(' · ')}</p>
                    <p className="note"><strong>{t('informationGaps')}:</strong> {(candidate.analysis.informationGaps ?? []).join(' · ') || t('noneRecorded')}</p>
                    {candidate.analysis.marketAnalysis && <MarketAnalysisReview plan={candidate.analysis.marketAnalysis.plan} analysis={candidate.analysis.marketAnalysis} />}
                    {candidate.analysis.researchFramework && <section className="research-framework" aria-label="Research framework">
                      <div className="research-framework-heading">
                        <div>
                          <h4>{t('framework')}</h4>
                          <p>{t('frameworkDetail')}</p>
                        </div>
                        <div className="research-framework-badges">
                          <span className="badge">Evidence: {frameworkLabel(candidate.analysis.researchFramework.evidenceQuality)}</span>
                          <span className="badge">Scenarios: {frameworkLabel(candidate.analysis.researchFramework.scenarioReadiness)}</span>
                        </div>
                      </div>
                      <p><strong>Coverage rationale:</strong> {candidate.analysis.researchFramework.coverageRationale}</p>
                      <div className="research-framework-grid">
                        <div><strong>{t('marketContext')}</strong><p>{candidate.analysis.researchFramework.marketContext.join(' · ') || 'Not evidenced in the current research pack.'}</p></div>
                        <div><strong>{t('sectorDrivers')}</strong><p>{candidate.analysis.researchFramework.sectorDrivers.join(' · ') || 'Not evidenced in the current research pack.'}</p></div>
                        <div><strong>{t('companyDrivers')}</strong><p>{candidate.analysis.researchFramework.companyDrivers.join(' · ') || 'Not evidenced in the current research pack.'}</p></div>
                        <div><strong>{t('valuationDrivers')}</strong><p>{candidate.analysis.researchFramework.criticalValuationDrivers.join(' · ') || 'Not ready without further validated financial evidence.'}</p></div>
                      </div>
                      <p className="note"><strong>{t('monitoring')}:</strong> {candidate.analysis.researchFramework.monitoringTriggers.join(' · ')}</p>
                    </section>}
                    {candidate.reportUrl && <div className="analysis-report-cta">
                      <div>
                        <strong>{t('report')}</strong>
                        <p>Open the complete decision summary, scorecards, catalysts, risks, limitations, and disclosure in a presentation-ready PDF.</p>
                      </div>
                      <a className="action-button inline-action" href={candidate.reportUrl} target="_blank" rel="noreferrer">{t('openReport')}</a>
                    </div>}
                    {candidate.dcfLocked && <p className="note">The original analysis had limited financial data. Open valuation to check current filings, derive FCFF, and review assumptions.</p>}
                    <button className="action-button" type="button" onClick={() => setValuationCandidateId((current) => current === candidate.id ? null : candidate.id)}>
                      {valuationCandidateId === candidate.id ? t('closeValuation') : candidate.valuation ? t('reviewValuation') : t('openValuation')}
                    </button>
                    {candidate.valuation && typeof candidate.valuation.resultJson.fairValuePerShare === 'number' && <p className="security-state">Latest DCF fair-value scenario: {candidate.valuation.resultJson.currency} {candidate.valuation.resultJson.fairValuePerShare.toLocaleString(undefined, { maximumFractionDigits: 2 })} per share.</p>}
                    {valuationCandidateId === candidate.id && <ValuationWorkbench candidateId={candidate.id} exchange={candidate.exchange} currency={candidate.currency} country={candidate.country} onSaved={() => {
                      if (selectedRunId) void loadCandidates(selectedRunId);
                    }} />}
                    <details className="analysis-evidence"><summary>{t('audit')}</summary>
                      <p>{t('status')}: {candidate.analysisRunStatus ?? candidate.workflowStatus}</p>
                      {candidate.externalAnalysisRunId && <p>Internal reference: <code>{candidate.externalAnalysisRunId}</code></p>}
                      <p>{(candidate.analysis.groundedIn ?? []).length} evidence references retained.</p>
                      <ul>{(candidate.analysis.groundedIn ?? []).map((reference) => <li key={reference}><code>{reference}</code></li>)}</ul>
                    </details>
                  </> : <>
                    {candidate.reportUrl && <div className="analysis-report-cta">
                      <div>
                        <strong>{t('report')}</strong>
                        <p>The report is ready. It can be reviewed while the dashboard finishes importing its structured analysis.</p>
                      </div>
                      <a className="action-button inline-action" href={candidate.reportUrl} target="_blank" rel="noreferrer">{t('openReport')}</a>
                    </div>}
                    <p className="note">The approved security is processed independently. Limited-data analysis uses research evidence and price risk; DCF remains locked without structured statements.</p>
                  </>}
                </div>
              )}
              </details>
            </article>;
          })}</div></div>
        )}
      </section>
    </main>
  );
}
