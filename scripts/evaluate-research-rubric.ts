import { readFile, mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { planResearchEvaluation, prepareEvaluationCase } from '../src/lib/research/evaluation';
import { runResearchManager } from '../src/lib/research/manager';
import type { ResearchPromptProfile } from '../src/lib/research/rubric';

async function main() {
  const { values } = parseArgs({ options: {
    cases: { type: 'string', default: 'tests/fixtures/research-rubric-evaluation-v1.json' },
    trials: { type: 'string', default: '1' }, limit: { type: 'string' }, live: { type: 'boolean', default: false },
    out: { type: 'string' }, 'max-model-calls': { type: 'string', default: '6' },
  }, strict: true, allowPositionals: false });
  const file = await readFile(resolve(values.cases!), 'utf8');
  if (Buffer.byteLength(file) > 8_000_000) throw new Error('evaluation_dataset_size');
  const input = JSON.parse(file);
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 24)) throw new Error('evaluation_case_limit');
  // Validate the complete dataset before applying a requested subset.
  const full = planResearchEvaluation(input, Number(values.trials));
  const { dataset, manifest } = limit === undefined ? full
    : planResearchEvaluation({ ...full.dataset, cases: full.dataset.cases.slice(0, limit) }, Number(values.trials));
  if (!values.live) { console.log(JSON.stringify({ mode: 'preflight_only_no_model_calls', ...manifest }, null, 2)); return; }
  const ceiling = Number(values['max-model-calls']);
  if (!Number.isInteger(ceiling) || ceiling < 1 || ceiling > 1440 || manifest.maximumModelCalls > ceiling)
    throw new Error('evaluation_model_call_ceiling');
  if (!values.out) throw new Error('evaluation_output_path_required');
  if (!process.env.RESEARCH_MODEL_API_KEY || !process.env.RESEARCH_MODEL_NAME) throw new Error('evaluation_model_unconfigured');
  const output = resolve(values.out); await mkdir(dirname(output), { recursive: true });
  // Exclusive creation prevents overwriting a prior result. Mode 0600 protects private briefs/passages.
  const handle = await open(output, 'wx', 0o600);
  try {
    await handle.write(JSON.stringify({ type: 'manifest', mode: 'live_model_evaluation', ...manifest,
      model: process.env.RESEARCH_MODEL_NAME, startedAt: new Date().toISOString() }) + '\n');
    // Process-local only; never change production flags or persist credentials.
    process.env.RESEARCH_MODEL_ENABLED = 'true'; process.env.RESEARCH_MANAGER_ENABLED = 'true';
    // Freeze evidence even if the invoking shell enables the Apple primary-source adapter.
    process.env.FILINGLENS_ISSUER_PRIMARY_READ_ENABLED = 'false';
    let modelCalls = 0;
    for (const [index, row] of dataset.cases.entries()) {
      const { screen, narrative } = prepareEvaluationCase(row);
      for (let trial = 0; trial < manifest.trials; trial++) {
        const order: ResearchPromptProfile[] = (index + trial) % 2 ? ['curated', 'baseline'] : ['baseline', 'curated'];
        for (const profile of order) {
          if (modelCalls + 3 > ceiling) throw new Error('evaluation_model_call_ceiling');
          const started = performance.now();
          const run = await runResearchManager(screen, row.brief, { narrative, promptProfile: profile });
          modelCalls += run.modelCalls;
          await handle.write(JSON.stringify({ type: 'run', caseId: row.id, trial, profile,
            expected: row.expected, reviewChecks: row.reviewChecks, elapsedMs: performance.now() - started,
            qualityVerdict: 'requires_human_review', run }) + '\n');
          await handle.sync(); // A later interruption must not erase already completed paid trials.
          console.log(JSON.stringify({ caseId: row.id, trial, profile, status: run.status, modelCalls: run.modelCalls }));
          if (run.status === 'failed_closed') throw new Error('evaluation_run_failed_closed');
        }
      }
    }
    await handle.write(JSON.stringify({ type: 'complete', modelCalls, qualityVerdict: 'requires_human_review' }) + '\n');
  } finally { await handle.close(); }
}
main().catch(() => { console.error('Research evaluation stopped: check dataset schema, limits, credentials and a new output path. No quality pass was issued.'); process.exitCode = 1; });
