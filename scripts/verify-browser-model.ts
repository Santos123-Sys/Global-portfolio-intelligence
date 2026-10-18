import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ResearchBrowser, FIXTURE_ORIGIN, FIXTURE_QUOTE, captureEvidence } from '../src/lib/browser/engine';
import { propose } from '../src/lib/browser/operator';
import type { BrowserRun } from '../src/lib/browser/contracts';

if (!process.env.RESEARCH_MODEL_API_KEY || !process.env.RESEARCH_MODEL_NAME) {
  throw Error('RESEARCH_MODEL_API_KEY and RESEARCH_MODEL_NAME are required');
}
const engine = new ResearchBrowser([FIXTURE_ORIGIN], true);
const now = Date.now();
const run: BrowserRun = {
  id: randomUUID(), owner: 'canary', actor: 'canary', authSession: 'canary', accountId: 'canary',
  input: {
    company: 'Controlled issuer fixture', year: 2025,
    question: 'Find the 2025 annual report and capture the exact passage explaining how recurring maintenance contracts supported customer retention. Then finish.',
    sourceUrl: FIXTURE_ORIGIN + '/', idempotencyKey: randomUUID(), mode: 'model',
  },
  issuerId: 'us:0000000001', companyName: 'Controlled issuer fixture',
  state: 'running', epoch: 0, version: 0, seq: 0, controller: null,
  createdAt: now, expiresAt: now + 120_000, leaseUntil: now + 120_000, worker: 'canary',
  actions: 0, calls: 0, tokens: 0, reason: null, observation: null, evidence: [],
};
const receipts: Array<{kind: string; tokens: number; durationMs: number}> = [];
const abort = AbortSignal.timeout(120_000);
abort.addEventListener('abort', () => { void engine.close(); }, { once: true });
try {
  run.observation = await engine.open(FIXTURE_ORIGIN + '/');
  for (let i = 0; i < 6; i++) {
    const started = Date.now();
    const decision = await propose(run, run.observation, AbortSignal.any([abort, AbortSignal.timeout(25_000)]));
    run.calls++;
    run.tokens += decision.tokens;
    const previous = run.observation;
    run.observation = await engine.execute(decision.action, previous.id);
    run.actions++;
    if (decision.action.kind === 'capture') {
      run.evidence.push(captureEvidence(previous, decision.action.quote, {
        issuerId: run.issuerId, year: run.input.year, originalUrl: run.input.sourceUrl,
      }, randomUUID()));
    }
    receipts.push({kind: decision.action.kind, tokens: decision.tokens, durationMs: Date.now() - started});
    if (decision.action.kind === 'finish') break;
  }
  console.log(JSON.stringify({kind: 'browser-canary-receipts', receipts, calls: run.calls, tokens: run.tokens}));
  assert.equal(receipts.at(-1)?.kind, 'finish', 'Model did not finish within six calls');
  assert.ok(run.evidence.some(e => e.text.includes(FIXTURE_QUOTE)), 'Required exact evidence missing');
  console.log(JSON.stringify({kind: 'real-model-controlled-browser-canary', success: true,
    syntheticSource: true, productionWorkflowVerified: false,
    calls: run.calls, tokens: run.tokens, receipts, elapsedMs: Date.now() - now}));
} finally {
  await engine.close();
}
