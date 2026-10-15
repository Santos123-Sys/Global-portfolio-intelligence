# Unified investment workspace — decision and implementation

15 October 2026. Confidence 4/5. Baselines: GPI 478cd85a9474e09c3b549100e0c900aa630c4840; FilingLens 1f74789f0f9bd6fe7b9a3124fa79f85f447e8f25. Both are verified Railway production commits from the preceding release.

## Decision

Unify the user experience in GPI and keep three bounded modules. A single product does not require a single database or runtime. The current financial engine uses Hono/MySQL/Python, GPI uses Next/PostgreSQL, and Risk Studio uses Bun functions already tracked in GPI. There is no workload or cost evidence that migrating all three into one process would improve reliability. The existing GPI portfolio panel already consumes actual Risk Studio analytics and reviewed FilingLens valuations; the missing connection is a cohesive company workflow and financial analysis inside the same workspace.

| Candidate | Feasibility and user outcome | Cost / latency | Risk / operability | Decision |
|---|---|---|---|---|
| Three separate apps (baseline) | Working typed integrations; repeated navigation/context review | Existing model and service calls | Separate releases; fragmented workflow | Retain as recovery paths |
| One workspace with research, embedded financial analysis and native portfolio views | Reuses actual modules and signed issuer/workspace handoffs | No added model calls, vector service or paid infrastructure; existing handoff plus one quality read. Runtime latency must be measured | Small compatible releases; independent failure domains; exact origin/window message checks | Implement |
| One runtime/database | Technically possible after porting financial/Python/Bun workloads and migrating user data | Migration and ongoing resource costs unknown; network hop savings unmeasured | Shared failure domain, substantial data migration and rollback burden | Reject for this release |

These are design judgments and relative resource estimates, not measured user-study outcomes. Neither an iframe nor a monorepo alone proves a better user experience. Task completion and source/issuer correctness are the acceptance tests.

## Dependency and trust model

The signed-in GPI session selects a canonical CIK/CNPJ. Private documents retain original bytes and named text derivatives. Research reads only owner/issuer/period-filtered, integrity-checked evidence. A renewed explicit issuer confirmation creates the existing signed FilingLens handoff. FilingLens verifies the ticket, reviews the filing and computes valuation server-side. Publication still requires the existing explicit approval. A minimal browser event can request import; it cannot authorize one. GPI independently rechecks the authenticated account and issuer through its existing server import. Portfolio calculations remain in Risk Studio.

All external inputs and retrieved text are untrusted. Financial facts, analyst assumptions and model interpretation remain distinct. No new agent, model provider, trading capability, SAP integration or lakehouse product is introduced.

## Robustness scope

- Unified task surface: company context, source quality, financial analysis and portfolio steps, real states and recovery paths. Keep modules mounted during workspace step changes.
- Governed data layers: originals (raw), hash-verified text derivatives (validated), approved valuation/risk snapshots (curated). These are logical layers in existing storage, not a claim that an enterprise data lake was installed.
- Financial controls: independent portfolio value/weight reconciliation before persistence; retain units, currencies, dates and issuer IDs; no inferred missing facts.
- RAG: freeze a small bilingual evaluation including irrelevant/common-word no-answer, wrong issuer/year and tampered derivative cases before edits. Normalize lexical scoring and abstain when there are no informative terms. Exact quotes and offsets remain unchanged; no semantic-recall claim.
- Security: CSP allows only the configured financial origin as an embedded module; FilingLens restricts framing to configured GPI. Messages require exact source window and origin, a bounded schema and the selected candidate. Existing server scopes remain authoritative.

## Acceptance and release

Tests must prove no wrong-origin/window message can trigger import; switching company destroys the old analysis session and confirmation; blocked embedding offers an explicit separate-tab recovery; corrupt originals cannot download and corrupt derivatives cannot enter research; duplicate ingestion remains idempotent; financial value/weight mismatches are rejected. Existing signed-in fixture and mobile/desktop browser workflows remain passing. There is no schema migration or bulk data movement. Roll back by reverting this release and redeploying the prior commits. Public health is distinct from authenticated task verification.

## Primary guidance

SAP MDG catalogued validation rules: https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/6d52de87aa0d4fb6a90924720a5b0549/47cd340e7449473698b6f604c977ae2b.html
Databricks logical quality layers: https://docs.databricks.com/gcp/en/lakehouse/medallion
Microsoft RAG evaluation: https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/rag/rag-solution-design-and-evaluation-guide
Exact origin messaging: https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage

The implementation adapts governance principles. It is not SAP certified and does not connect to SAP.

## Implemented experience and state contract

The default Workspace tab now presents Sources → Financial analysis → Portfolio for one selected listing. Selecting a different company remounts that company's workspace and discards its prior embedded authorization. The source-library document handoff opens within the same financial panel. The normal signed company handoff also opens there; private document transfer and valuation approval continue to use existing authenticated/signed APIs. Switching workflow steps retains mounted analysis. Separate-tab links are recovery paths, not a claim of single sign-on across all legacy interfaces.

States come from actual responses: source counts are verified/empty/blocked/unavailable, valuations and portfolio runs are available/empty/unavailable, and analysis opening/import displays preparing, received, verified or retry-pending. No progress percentage, cost estimate, inferred financial figure or fabricated success is shown. The overview's check timestamp is visible. User documents retain asserted issuer/year labels; hash verification does not establish source truth.

Governance controls run at ingestion, download and retrieval boundaries. The rule version is corpus-integrity.v1. Metadata identity, original hash/byte count and named derivative hash are verified where their bytes are read. Original corruption blocks download; altered text blocks stored research reads. The standalone lexical retriever also excludes a corrupt derivative defensively. No quarantine bucket or data deletion was introduced. Recovery is investigation plus reimport from a trusted original; original records are not automatically overwritten.

The financial boundary reconciles shares × price to holding value, holding value to total and weights, and the provider's portfolio marketValue to the summed holdings. Tolerances accommodate floating point (1e-8 relative for value; 1e-6 for weights). These are engineering reconciliation checks, not an audit opinion on source financial statements. Existing units, currency, FX and approval checks remain active.

## Verification evidence so far

Frozen synthetic retrieval evaluation v1: seven cases, 100 local iterations each, two failures before the patch and none after it. The failures were common-word contamination and acceptance of altered text. Positive English and accented-Portuguese cases and wrong-issuer/year exclusion remain passing. This is a small targeted regression set; it was used to diagnose the defects and is not an independent holdout or an estimate of production recall. Local p95 preparation times on these short fixtures were below 0.3 ms after integrity checks; the baseline was below 0.04 ms. Added hashing/schema validation increases CPU work; no latency improvement is claimed. Existing long-tail and public Apple evidence tests remain passing.

All 161 GPI unit/integration tests passed, including real FilingLens publication/notification with isolated storage; all 322 FilingLens tests passed. Type checks and both production builds passed. GPI lint has no errors and the existing apostrophe warning; changed FilingLens files pass targeted lint. Existing unrelated FilingLens lint debt is not represented as fixed.

Browser fixtures exercise the actual parent UI at 390/1440 px, a cross-origin child publication event, wrong-issuer rejection, exact server import inputs and preserved analysis through workflow-step changes. They mock provider content and API data. They cannot establish authenticated production usability, model answer quality or real SEC access.

## Resource and architecture boundaries

The new overview performs bounded owner-scoped reads, in parallel, and does not start model generations. Text inspection refuses windows exceeding the existing 12 MB corpus read cap. The embedded SPA loads only after the user's opening action; once opened it stays mounted while switching steps. Retrieval remains request-local BM25 with issuer/year filters and a ten-excerpt output cap. No embedding index, reranker or new autonomous agent is added. Relative model-call cost of the shell is zero additional calls; hosted-service cost and user task latency have not been benchmarked. Model budgets remain those of the existing research and FilingLens engines.
