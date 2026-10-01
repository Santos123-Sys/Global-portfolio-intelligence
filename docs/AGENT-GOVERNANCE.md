# Unified Agent Governance

## Implementation scope

The existing four-layer architecture, PostgreSQL/Drizzle infrastructure, Next.js routes, Railway finance worker, NewsAdapter and deterministic finance engines remain in place. There is no migration to an autonomous-agent framework and no trading capability.

The shared contract registry contains 23 identities: four legacy agents, eight DCF agents, nine Analysis Swarm agents, the research director and the quality validator. Market-adaptive modules inside legacy Security Analysis inherit its model policy; they remain internal modules, not separately configurable autonomous agents.

## Priorities delivered

| Priority | Implementation |
| --- | --- |
| 0: correctness | Runtime web-search enforcement, tool allowlists, empty observed thesis-breaker lists, updated synthesis role wording, protected-policy labels, common 0–100 confidence rubric |
| 1: integration | Shared registry, per-role effective model/effort/limits, protected-policy preview, immutable versions, configuration hashes and per-session snapshots |
| 2: prompt quality | Structured authority/source/financial/output/failure policies, classified claims, strict provider output envelope, post-generation role data schemas, independent specialist context, judge disagreement protocol, stronger citation and source attribution checks |
| 3: operations | Draft/evaluate/promote/rollback, 30 synthetic B3/US/SIX diagnostics with baseline comparison, durable evaluation checkpoints, shadow/canary deployment, persisted tool traces, authoring token/latency telemetry and optional operator-supplied price estimates |

Legacy confidence remains 0–1 in existing API/database contracts to avoid breaking dashboard consumers. It is explicitly a scaled version of the common 0–100 rubric. No empirical calibration claim is made.

## Admin workflow

1. Admin → Agent Settings opens the unified Agent control center.
2. Choose an agent by workflow/layer. Deterministic engines expose protected instructions and tools; prompt text cannot change their arithmetic.
3. Edit objective, output emphasis, and permitted model settings. Protected rules and mandatory grounding tools cannot be removed.
4. Save an immutable **draft**. Saving does not silently replace production.
5. Evaluate the draft. Deterministic roles run configuration-policy checks; model/legacy roles run 30 baseline + 30 candidate synthetic diagnostics and source-verification passes. The UI asks before incurring model charges.
6. Inspect the persisted report and baseline/candidate rates. Candidate diagnostics must all pass; each market must not regress by more than two percentage points.
7. Promote to production, or use isolated shadow/10% canary for Analysis Swarm model roles. Existing running sessions keep their snapshot; new sessions resolve the active rollout.
8. Roll back to a previously deployed version with a still-valid evaluation hash. Changed protected policies invalidate previous hashes and require reevaluation.

Owner isolation and platform-admin permissions are preserved. Settings apply to the configuring owner's workflows, not automatically to other owners. Cross-origin mutations are rejected and version transitions are serialized using PostgreSQL advisory locks.

Hashes include the protected registry text, governance version, runtime policy, customization and Railway's `RAILWAY_GIT_COMMIT_SHA` when available. Code revisions can therefore invalidate previous evaluation hashes; reevaluate before promotion/rollback on a new revision. Local runs without Railway revision metadata are labeled `local-unversioned`, not fully code-reproducible deployments. Existing in-flight snapshots preserve their original hash/revision.

## Runtime controls

- The Tool Registry verifies registered agent identity, protected allowlist, effective enabled tools, destination, session scope and per-agent call budget before executing a handler.
- Live handlers revalidate DCF/WACC/simulation arguments, message sender/session, memory sender, and owned issuer data access.
- Exceptions are recorded with sanitized error codes, latency, agent/tool identity and configuration hash; secrets/raw request bodies are not stored in traces.
- Analysis roles receive only relevant predecessor results; Bull and Bear cannot read each other's fresh argument before the Judge stage.
- Agent outputs expose public audit summaries, not hidden chain-of-thought.
- Owner customization is placed in lower-priority user input, not appended as privileged system instructions. Model/limit settings are validated separately in code.
- Provider generation uses a strict JSON-schema envelope. Heterogeneous findings are encoded as `dataJson`, decoded into the existing `data` contract, and checked against local role schemas. The nested data schema is not provider-enforced.
- An explicitly configured fallback is used only for transient 429/5xx authoring failures, never authentication/schema errors. Legacy worker stages do not support fallback.
- Source verification is a separate pass, not an independent provider/model family. It checks coverage, entailment, reported versus modeled claims, periods, units/currencies, freshness and conflicts. Model verification can itself be wrong; human review remains necessary.
- Financial observations are attributed to their retained source and fiscal/currency metadata, rather than copying all facts under every source URL.

## Durable evaluations

`agent_evaluation_jobs` stores immutable candidate/baseline snapshots and completed case pairs. Existing `processQueuedSessions()` processes one evaluation pair per poll, with a renewable lease and transactional checkpoint. Interrupted work requeues after lease expiry; completed pairs are not replayed. An interrupted in-progress pair may incur duplicate model charges when retried. Queued evaluation and finance analysis both use the existing Railway finance runtime; no additional worker service is required.

An optional Next.js `after()` kick runs one pair when a dashboard API key is available; the database queue is authoritative, not the process lifetime. Without an active finance worker or repeated authorized cron execution, the remaining diagnostics stay queued. There is no unbounded background promise tied only to the request.

## Deployment

1. Apply dashboard/finance database migrations `0022_tiresome_klaw.sql` and `0023_vengeful_wilson_fisk.sql` before deploying code that queries the new columns/tables. Do not apply these to the separate legacy agentic job database by mistake.
2. Deploy both dashboard and Agentic Worker from this revision (`npm run build:agentic` rebuilds the bundled finance runtime and shared contract).
3. Keep the existing `FINANCE_DATABASE_URL` on the worker pointing at the dashboard/finance database. The worker needs its existing `OPENAI_API_KEY`; no credential belongs in browser/public variables.
4. Confirm the existing finance worker or authorized `/api/cron/agent-finance` caller is running.
5. Open Agent Settings and check all 23 registry identities, historical versions, policy previews and current model settings.
6. Test disabled web search, tool denials, session scope, immutable snapshots and rollback in a staging environment.
7. Explicitly start paid diagnostics; then run real issuer fixtures with reviewed source data before broad promotion.

Optional `AGENT_MODEL_PRICING_JSON` supplies per-million-token prices by exact model name, e.g. `{ "your-model": { "input": 0, "output": 0 } }`. Replace zeros with verified provider prices before use. Invalid/missing prices produce null, not guessed costs. Authoring token/cost estimates exclude verification, rejected/fallback request usage and other pipeline calls; they are not an invoice total.

## Quality limits and acceptance gates

Synthetic diagnostics cover known revenue/currency, absent evidence, empty observed-breaker lists, prompt injection and claim grounding in each market. They do **not** certify investment quality, extraction recall across arbitrary PDFs, candidate-ranking stability, confidence calibration or real-world citation entailment. Legacy diagnostics test role-policy adherence through the shared model adapter; they do not replace end-to-end legacy stage-schema regression tests.

Every evaluation fixture also has an expected terminal status: supplied evidence must produce `completed`, while deliberately absent evidence must produce `insufficient_data`. A `blocked` result always fails evaluation, even if its partial fields and citations happen to be valid.

The original target metrics—95% entailment, 99% schema success, zero invented thresholds and calibrated confidence—remain measurement targets, not achieved production statistics. Complete empirical validation requires a human-labeled real issuer/thesis dataset, paid provider access and observed production outcomes. No configuration is automatically accepted as financial advice or submitted as a trade.

The Operations view compares confidence bands against the existing human-feedback ratings for up to 500 recent completed sessions. Missing feedback is excluded, not converted to a zero score. This measures reviewer agreement, not investment-return probabilities. Final confidence excludes fixed-score orchestration/planning agents, avoiding the previous artificial 60-point cap, while incomplete required agents still prevent report acceptance.

## Verification

Use `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run build:agentic`. Regression tests cover registry completeness, hashes, tool/session authorization, call budgets, context isolation, strict schema requests, explicit fallback rules, usage metadata, evaluation gates, empty observed-breaker lists and disabled Discovery retrieval.
