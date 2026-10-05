# Canonical research orchestration contract

## Decision

Global Portfolio Intelligence has one authority for security/company research and investment analysis: the financial Research Director runtime in `src/lib/agent-finance/**`, executed by the worker through the bundled finance runtime.

The generic Agentic Research Service in `services/agentic/**` remains responsible for bounded preparatory jobs only:

- thesis/document extraction;
- market/universe discovery;
- candidate market briefs;
- delivery/callback compatibility for historical generic jobs.

It must not create, retry, or execute new security-analysis jobs.

## Canonical execution path

`human-approved mandate -> discovery -> candidate approval -> approved market brief -> canonical agent_analysis_session -> Research Director -> specialist research -> valuation -> bull/bear -> judge -> QA -> human review`

New security analysis is persisted first in the dashboard's `agent_analysis_sessions` queue. The finance runtime claims that durable session and `Research Director` is the only orchestration authority allowed to decompose research, invoke financial specialists, run the debate, and synthesize the result.

## Discovery handoff

A Discovery candidate stores `analysis_session_id` when financial analysis is approved. The session request is tied to the candidate's current `portfolioId` and `thesisVersionId`; therefore stale research cannot be mistaken for research under a newer mandate.

The existing `external_analysis_run_id` column and historical `/v1/analysis-runs/:id` read/report endpoints remain temporarily for backwards compatibility with already-created jobs. New writes to `/v1/analysis-runs` and new retry attempts on legacy analysis runs return HTTP 410.

## Evidence continuity

Discovery continues to persist source-backed market briefs, price history, risk snapshots, filings and market observations before the canonical session runs. `loadFoundation()` already reads the approved candidate market brief, thesis, portfolio, observations, documents and price history for the same owner/security. No prose or legacy agent output is silently promoted into deterministic financial facts.

## Authority rules

1. `services/agentic/src/process-job.ts` may execute only `thesis_extraction`, `market_discovery`, and `market_brief` jobs.
2. `analysis_run` is a retired production job kind. A historical record may be read, but it cannot be newly created, retried or executed.
3. `src/lib/agent-finance/l1/research-director.ts` is the sole security-analysis orchestrator.
4. Human approval remains required before candidate research starts and before research is accepted into an investment decision.
5. Deterministic quant/valuation calculations stay outside model prose and keep source lineage.

## Compatibility and migration

This migration is additive. Existing external run records, imported `ai_analyses`, PDFs, and candidate links remain readable. New candidates use `analysis_session_id`. The candidate API prefers the canonical session when present and falls back to historical external-run data only when no canonical session exists.

No historical record is deleted by this change.