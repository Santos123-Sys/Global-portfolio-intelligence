import { z } from 'zod';
import { readBoundedJson } from '../request-body';
import type { ScreenResult } from '../foundation/screening';
import { readIssuerStatement } from '../integrations/issuer-statement-client';
import { ResearchBrief, ResearchPlan, Findings, Critique, type Evidence, type ResearchRun } from './contracts';
import { collectEvidence, coverageGaps, executeEvidenceTool } from './evidence-tools';
import { PLANNER_PROMPT, ANALYST_PROMPT, CRITIC_PROMPT, PROMPT_VERSION } from './prompts';

export type ModelCall = (system: string, input: unknown, signal: AbortSignal) => Promise<{ value: unknown; usage: unknown }>;
export async function callResearchModel(system: string, input: unknown, signal: AbortSignal, transport: typeof fetch = fetch) {
  const token = process.env.RESEARCH_MODEL_API_KEY, model = process.env.RESEARCH_MODEL_NAME;
  if (!token || !model) throw new Error('research_model_unconfigured');
  const content = JSON.stringify(input);
  if (Buffer.byteLength(content) > 64_000) throw new Error('research_context_budget');
  const response = await transport('https://api.openai.com/v1/chat/completions', {
    method: 'POST', redirect: 'error', signal,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_completion_tokens: 2400, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content }] }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error('research_model_request_failed'); }
  const body = await readBoundedJson(new Request('https://response.invalid', { method: 'POST', body: response.body,
    headers: { 'content-type': response.headers.get('content-type') ?? '' }, signal, duplex: 'half' } as RequestInit), 64_000);
  if (!body.ok) throw new Error('research_model_invalid_response');
  const envelope = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().max(48_000) }) })).min(1),
    usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }).optional() }).parse(body.value);
  return { value: JSON.parse(envelope.choices[0].message.content) as unknown, usage: envelope.usage ?? null };
}

export function validateFindings(value: unknown, evidence: Evidence[]) {
  const draft = Findings.parse(value);
  const byId = new Map(evidence.map(row => [row.id, row]));
  for (const finding of draft.findings) {
    const ids = finding.citations.map(c => c.evidenceId);
    if (new Set(ids).size !== ids.length) throw new Error('duplicate_citation');
    for (const citation of finding.citations) {
      const record = byId.get(citation.evidenceId);
      if (!record || !record.text.includes(citation.quote)) throw new Error('unsupported_citation');
    }
  }
  return draft;
}

/** Bounded supervisor: the model proposes a plan; application code owns authority and termination. */
export async function runResearchManager(screen: ScreenResult, input: ResearchBrief, options: {
  call?: ModelCall; readIssuer?: typeof readIssuerStatement;
} = {}): Promise<ResearchRun> {
  const brief = ResearchBrief.parse(input);
  const started = Date.now();
  const run: ResearchRun = { architecture: 'bounded-research-manager-v1', promptVersion: PROMPT_VERSION,
    brief, status: 'needs_sources', plan: null, evidence: [], findings: [], gaps: [], trace: [], modelCalls: 0, stopReason: 'no_usable_evidence' };
  let stage = 'collect_evidence';
  try {
    let issuer = null;
    if (screen.candidate.issuer?.registryId === '0000320193' && screen.candidate.issuer.jurisdiction === 'us' &&
      process.env.FILINGLENS_ISSUER_PRIMARY_READ_ENABLED === 'true') {
      const t = Date.now();
      try {
        issuer = await (options.readIssuer ?? readIssuerStatement)({ baseUrl: process.env.FILINGLENS_API_URL ?? '',
          token: process.env.FILINGLENS_ISSUER_PRIMARY_API_TOKEN ?? '' });
        run.trace.push({ stage: 'issuer_statement', status: 'received', elapsedMs: Date.now() - t });
      } catch { run.trace.push({ stage: 'issuer_statement', status: 'unavailable', elapsedMs: Date.now() - t }); }
    }
    run.evidence = collectEvidence(screen, brief, issuer);
    run.gaps = coverageGaps(run.evidence, brief);
    if (!run.evidence.length) return run;
    if (process.env.RESEARCH_MANAGER_ENABLED !== 'true' || process.env.RESEARCH_MODEL_ENABLED !== 'true') {
      run.status = 'model_disabled'; run.stopReason = 'model_disabled'; return run;
    }
    const overall = AbortSignal.timeout(100_000);
    const call: ModelCall = options.call ?? callResearchModel;
    const invoke = async (name: string, prompt: string, payload: unknown) => {
      stage = name;
      if (run.modelCalls >= 3 || overall.aborted || Date.now() - started > 110_000) throw new Error('research_budget_exhausted');
      const t = Date.now(); run.modelCalls++;
      const result = await call(prompt, payload, AbortSignal.any([overall, AbortSignal.timeout(30_000)]));
      run.trace.push({ stage: name, status: 'received', elapsedMs: Date.now() - t, usage: result.usage });
      return result.value;
    };
    const context = { brief, issuer: screen.candidate.issuer, company: screen.candidate.name };
    run.plan = ResearchPlan.parse(await invoke('plan', PLANNER_PROMPT, { ...context,
      inventory: run.evidence.map(({ id, metric, fiscalYear, sourceKind }) => ({ id, metric, fiscalYear, sourceKind })) }));
    stage = 'tools';
    const selected = new Map<string, Evidence>();
    for (const request of run.plan.tools) {
      const t = Date.now();
      const result = executeEvidenceTool(request, run.evidence, brief);
      result.evidence.forEach(row => selected.set(row.id, row));
      run.trace.push({ stage: request.tool, status: result.evidence.length ? 'results' : 'empty_or_coverage', elapsedMs: Date.now() - t, count: result.evidence.length });
    }
    const evidence = [...selected.values()];
    if (!evidence.length) { run.stopReason = 'no_retrieved_evidence'; return run; }
    const draft = validateFindings(await invoke('analyse', ANALYST_PROMPT, { ...context, plan: run.plan, evidence, gaps: run.gaps,
      toolReceipts: run.trace.filter(t => t.stage === 'search_evidence' || t.stage === 'inspect_coverage') }), evidence);
    run.gaps.push(...draft.gaps);
    if (!draft.findings.length) { run.stopReason = 'insufficient_evidence'; return run; }
    const critique = Critique.parse(await invoke('review', CRITIC_PROMPT, { ...context, evidence, draft }));
    if (critique.reviews.length !== draft.findings.length || new Set(critique.reviews.map(r => r.findingIndex)).size !== draft.findings.length ||
      critique.reviews.some(r => r.findingIndex >= draft.findings.length)) throw new Error('incomplete_review');
    run.findings = draft.findings.filter((_, index) => critique.reviews.find(r => r.findingIndex === index)?.verdict === 'supported');
    const rejected = draft.findings.length - run.findings.length;
    if (rejected) run.gaps.push(`${rejected} draft finding(s) withheld by evidence review; further source work is required.`);
    run.status = run.findings.length ? 'needs_human_review' : 'needs_sources';
    run.stopReason = run.findings.length ? 'bounded_review_complete' : 'review_withheld_all_findings';
  } catch {
    // No unreviewed model content or raw provider errors are published on failure.
    run.findings = []; run.status = 'failed_closed'; run.stopReason = 'stage_failed';
    run.trace.push({ stage, status: 'failed_closed', elapsedMs: Date.now() - started });
    run.gaps.push('Research stopped at a validation, provider or budget boundary. Evidence remains available for manual review.');
  }
  return run;
}
