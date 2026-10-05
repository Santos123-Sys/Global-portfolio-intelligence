# Platform V2 Architecture — Global Portfolio Intelligence

Status: foundational rebuild, October 2026.

## Product objective

Global Portfolio Intelligence should behave as an institutional research operating system, not as a collection of dashboards. The product must make the path from evidence to research to decision obvious, preserve human authority over investment actions, and remain technically flexible enough to support additional markets, data vendors and model providers without rewriting domain logic.

The existing financial swarm is retained because its strongest properties are already correct: deterministic finance beneath model-written analysis, source-linked claims, bounded research decomposition, opposing bull/bear perspectives, a judge layer, persisted run state and explicit human approval. Platform V2 makes that runtime canonical and removes accidental complexity around it.

## Benchmark patterns used

The rebuild borrows architecture patterns rather than code from the following projects:

- OpenBB Platform and Workspace — adapter-first financial data integration and a workspace-oriented product surface.
- LangChain Open Deep Research — supervisor-led research decomposition, configurable tools and bounded specialist work.
- TradingAgents — specialist financial agents with structured debate rather than a single opaque model call.
- Microsoft Magentic-UI — human co-planning, action guards, explicit review and transparent agent activity.
- Gilberto Legal Agentic System — sequential domain clusters, manager-level synthesis, explicit adversarial review and rerouting feedback only to the cluster that owns the disputed decision. Global Portfolio Intelligence applies that control pattern to investment constraints; it does not copy Gilberto's legal-domain agents or legal risk semantics.

What is deliberately *not* copied: autonomous trading, unconstrained agent spawning, hidden model consensus, provider-specific domain code, or UI progress that is not backed by persisted execution state.

## Target system map

```text
Experience plane
  Research Workspace | Company Workbench | Portfolio | Risk | Governance | Admin
            |
Domain API / application services
  Research sessions | Evidence | Analyses | Decisions | Portfolios | Entitlements
            |
Canonical intelligence runtime
  Research Director
      -> constraint decision pipeline
      -> bounded task scheduler
      -> dynamic research specialists
      -> deterministic DCF / statement analytics
      -> analysis specialists
      -> Bull + Bear
      -> Judge
      -> human approval
            |
Evidence and data plane
  Source adapters -> normalized evidence -> provenance / freshness -> retrieval
            |
Platform foundation
  PostgreSQL | object storage | leases | audit events | provider gateway | telemetry
```

## Architectural rules

### 1. One orchestration authority

`src/lib/agent-finance` is the canonical company research and analysis runtime. The older generic agentic job service may ingest, discover and dispatch work, but it should not independently implement a second version of company analysis. New analysis features belong in the canonical runtime or call it through a shared contract.

### 2. Research breadth is not provider concurrency

A combined analysis may justify eight research tasks. That does not justify eight simultaneous model calls. Platform V2 introduces a scheduler with two independent controls:

- `AGENT_MAX_CONCURRENCY` — maximum in-flight model-backed tasks (default 3, bounded 1–8).
- `AGENT_STAGGER_MS` — minimum spacing between task starts (default 900 ms, bounded 0–10 s).

Dynamic specialists, fixed analysis specialists and bull/bear debate are scheduled through the same policy. The research plan remains broad; execution becomes rate-limit aware and operationally predictable.

### 3. Model transport is an adapter boundary

Agent prompts, schemas and governance no longer know the OpenAI URL. `model-runtime.ts` owns the Responses-compatible transport. Existing `OPENAI_*` configuration remains the default, while `MODEL_API_KEY` and `MODEL_API_BASE_URL` can point the same governed runtime at another Responses-compatible provider or gateway.

This is intentionally narrower than pretending every model API is interchangeable. Providers with different protocols should receive explicit adapters behind the same boundary rather than conditional logic scattered across agents.

### 4. Deterministic finance remains authoritative for numbers

DCF, WACC, statement checks, ratios and scenario calculations remain deterministic. Language models may explain and challenge numerical outputs but may not silently recompute or overwrite them.

### 5. Evidence is a first-class object

Every material research claim should retain source, publication date, market/period context and exact supporting excerpt. Current conclusions should fail closed when evidence is stale or missing. A later V2 phase should formalize this into a citation/evidence graph so that every report section can show `claim -> evidence -> source -> freshness`.

### 6. Human authority is explicit

Agents can research, calculate, compare, challenge and recommend. They cannot mark a thesis approved, change portfolio weights or execute a trade. Approval, acceptance and portfolio actions remain explicit user operations with audit history.

### 7. Constraints have one owner and one enforcement meaning

Portfolio context, security eligibility and ranking preferences must not share one generic prose-warning channel. Inspired by Gilberto's cluster/manager architecture, thesis interpretation now follows a sequential constraint decision pipeline:

```text
Mandate / Allocation Manager
  investor profile, equity-scope deviation, liquidity horizon, review cadence
        ↓
Universe Manager
  listing market, security type, domicile, sector and industry gates
        ↓
Evidence Eligibility Manager
  source-backed categorical/legal/status facts and numeric hard predicates
        ↓
Ranking Manager
  qualitative growth/quality preferences that rank but never exclude
        ↓
Adversarial Constraint Auditor
  contradictions, missing evidence, duplicated rules and cross-domain tensions
        ↓
Research Director
  accepts the validated constraint state and starts security research
```

Each investor statement belongs to exactly one domain. Structured fields are authoritative when available; legacy prose is retained only when it cannot safely be classified without user judgment. This eliminates duplicate warnings and prevents context such as a 100% equity deviation from accidentally behaving like a security-level filter.

Hard eligibility can be expressed in three ways:

1. structured universe fields, such as `listingMarkets=BVMF` or `sectorsExcluded=Retail`;
2. deterministic numeric metrics with field, operator, value, unit and period;
3. categorical/evidence predicates. Evidence predicates additionally require source lineage and may enforce freshness. Missing evidence yields `unverified`, never an implicit pass.

For example, excluding companies in judicial recovery is represented as an evidence gate on `judicial_recovery_status = none`, requiring official/regulatory lineage and a bounded evidence age. The system must not infer that status from silence or generic company prose.

## Experience architecture

The prior interface exposed too many peer-level destinations in a wide navigation bar and duplicated the investment workflow beneath it. Platform V2 treats the product as a workstation:

- persistent desktop navigation rail;
- one sticky workflow context bar;
- wider professional content canvas;
- calmer cards, denser research information and fewer decorative effects;
- Research becomes a workspace/library rather than an inbox of unrelated cards;
- company pages remain the detailed workbench for active runs, evidence, valuation and debate;
- Research Operations remains the operational console for run/provider health.

The information hierarchy is now:

1. Strategy — investor profile and portfolio mandate.
2. Discovery — source and triage candidate companies.
3. Research — evidence-backed company analysis and valuation.
4. Portfolio — positions, allocation and risk.
5. Control — governance, research operations, settings and administration.

Strategy review should show blocking corrections first, then actionable constraint/evidence items, then non-blocking context. Internal validator phrases are implementation diagnostics, not the primary UX. Resolved structured constraints should disappear from the warning surface rather than being shown again as legacy prose.

## Commercial-readiness path

The codebase is not yet a commercial SaaS solely because the UI looks professional. Commercialization requires platform controls in addition to product functionality. Recommended sequence:

### Foundation

- canonical research runtime;
- governed scheduling and staggered provider calls;
- model transport boundary;
- workstation visual shell and Research Workspace;
- architecture contract documented.

### Constraint and decision integrity

- clustered constraint ownership;
- deterministic universe gates;
- source-backed evidence predicates;
- adversarial constraint audit before research dispatch;
- canonicalization of legacy creator/extraction prose into structured rules only when semantics are explicit;
- fail-closed behavior for missing hard-rule evidence.

### Platform hardening

- workspace/tenant model separated from individual user ownership;
- entitlements and plan limits by feature/provider/run budget;
- organization roles and audit export;
- per-workspace provider credentials or centrally managed provider pools;
- cost attribution per research session;
- structured telemetry for model/data-provider latency, error rate and token/call cost;
- idempotent queues and dead-letter/replay controls for every long-running job.

### Intelligence platform

- evidence graph and reusable source cache;
- source-adapter SDK with capability metadata (market, asset class, data type, freshness, entitlement);
- configurable research policies by mandate/market;
- benchmark/evaluation datasets and regression scoring for research quality;
- cross-company and portfolio-level synthesis built on accepted company artifacts rather than fresh ungoverned model calls.

### Commercial product

- onboarding and trial limits;
- subscription/billing integration;
- usage metering;
- tenant data-retention controls;
- exportable investment memos and evidence packs;
- SLOs, incident response, backup/restore drills and security review.

## Migration principle

Platform V2 is incremental. Existing validated deterministic calculations, database history, review gates and source controls should be migrated behind the new architecture rather than rewritten wholesale. Any legacy path should be removed only after its caller has been moved to the canonical runtime and regression tests cover the replacement.
