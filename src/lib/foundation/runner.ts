import { FilingLensReadError, loadFilingLensFinance, readFilingLensSnapshot } from '../integrations/filinglens-client';
import type { FilingLensReadState } from '../integrations/filinglens-client';
import { JobRequest } from './contracts';
import type { Candidate } from './contracts';
import { screenCandidate } from './screening';
import type { ScreenResult } from './screening';
import { researchWorkbench } from './research';
import { generateResearchDraft } from './model';

export async function financeForCandidate(candidate: Candidate): Promise<FilingLensReadState> {
  if (!candidate.issuer || process.env.FILINGLENS_READ_ENABLED !== 'true') return loadFilingLensFinance(candidate);
  try {
    return { status: 'ready', snapshot: await readFilingLensSnapshot(candidate.issuer, {
      baseUrl: process.env.FILINGLENS_API_URL ?? '', token: process.env.FILINGLENS_READ_API_TOKEN ?? '',
    }) };
  } catch (e) { return { status: 'unavailable', reason: e instanceof FilingLensReadError ? e.code : 'finance_read_failed' }; }
}
export async function executeJob(value: unknown, readFinance = financeForCandidate, draft = generateResearchDraft) {
  const job = JobRequest.parse(value);
  const started = Date.now();
  const trace = { architecture: 'usa-cvm-foundation-v1', startedAt: new Date(started).toISOString(),
    maximumCandidates: 20, modelCallsAllowed: job.kind === 'research' && process.env.RESEARCH_MODEL_ENABLED === 'true' ? 1 : 0 };
  const candidates = job.kind === 'research' ? job.workspace.candidates.filter(c => c.key === job.candidateKey) : job.workspace.candidates;
  const screens: ScreenResult[] = [];
  for (const c of candidates) {
    if (Date.now() - started > 145_000) throw new Error('run_budget_exhausted');
    const finance = job.workspace.profile.markets.includes(c.market) ? await readFinance(c) :
      { status: 'unsupported_market' as const, reason: 'Candidate excluded by the selected profile.' };
    screens.push(screenCandidate(c, job.workspace.profile, finance));
  }
  if (job.kind === 'screen') return { kind: 'screen' as const, screens, trace: { ...trace, elapsedMs: Date.now() - started }, stopReason: 'screen_complete' };
  const screen = screens[0];
  let generated = null; let modelStatus = 'disabled_or_no_evidence';
  try { generated = await draft(screen); if (generated) modelStatus = 'draft_requires_review'; }
  catch { modelStatus = 'model_failed_evidence_pack_retained'; }
  return { kind: 'research' as const, report: researchWorkbench(screen, generated?.draft ?? null), modelStatus,
    trace: { ...trace, model: generated?.model ?? null, usage: generated?.usage ?? null, elapsedMs: Date.now() - started }, stopReason: 'evidence_pack_complete' };
}
