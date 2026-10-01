# Agentic Equity Research implementation and rollout

## Architecture decision

Implement the Agentic UX **contracts before the analytical agents**, then evolve the UX alongside each analytical stage. Do not build a second orchestration system. The existing four layers remain authoritative:

| Layer | Responsibility | Integration |
| --- | --- | --- |
| L1 | Research Director and specialist orchestration | Existing PostgreSQL queue, worker, frozen evidence/configuration snapshots and explicit human review |
| L2 | Model routing and protected prompts | Existing GPT-6 Sol baseline, approved runtime policies, independent claim verification and configuration hashes |
| L3 | JSON Tool Registry and execution controls | Existing permissions/budgets/traces plus statement, industry and scorecard tools; persisted semantic events |
| L4 | Evidence and deterministic computation | Existing provider observations, coherent filings, document/RAG stores, valuation functions and NewsAdapter |

PostgreSQL, Drizzle and Next.js routes are reused. No new scraper, queue service, separate report generator, foreign stylesheet or autonomous trade path is introduced.

## Ordered implementation

| Phase | Approved priority | Delivered implementation |
| --- | --- | --- |
| 0 | Establish UX and authority contracts | Research plan, visible permitted/forbidden actions, event contract, return briefing, pause/resume/cancel/retry, no implicit timeout approval |
| 1 | Brazil/Portuguese Equity Research schema | Versioned `equity-research-v1` aggregation; retained issuer market/currency/period metadata; requested locale or approved thesis locale; Brazil defaults to Portuguese when neither is specified |
| 2 | Deterministic Financial Analyzer | Registered normalized statement tool; annual/discrete-quarter/YTD handling; average-balance returns and working-capital days; CFO-minus-CapEx FCF; screening signals and explicit limitations |
| 3 | Earnings-quality and risk integration | Quality/ratio specialists and bull/bear/judge receive deterministic statement results; normalized calculations are authoritative over ending-balance fallbacks |
| 4 | Applicable Market Brief modules | Existing candidate MarketBrief and NewsAdapter evidence; sizing cross-validation, TAM/SAM/SOM, price-volume-mix, lifecycle, competitive concentration, customer/supplier concentration; consumer channels only when relevant |
| 5 | Optional value policy | Investor-approved thesis enables the 20-criterion scorecard, dimension weights and evidence-coverage threshold; protected model evaluates criteria, registered deterministic tool calculates review-only totals |
| 6 | Shared reports and styling | One aggregation contract and existing dashboard; existing glass-green classes and recharts; no imported report/CSS duplication |
| 7 | Quality gates before scoring | Sector-aware suppression, field/period source lineage, provenance/duration review checkpoint, exact retained excerpts and nullable scores; totals withheld when quality or coverage fails |

### Provider integration

The provider policy describes the existing source adapters; it does not claim a fresh retrieval occurred. Research reads persisted, attributable evidence. Missing evidence remains missing.

| Market | Existing source policy | Important boundary |
| --- | --- | --- |
| Brazil | BrAPI for B3 listings/tickers/quotes/basic indicators; Maritaca/CVM for filings/research/macro; NewsAdapter for news | EODHD remains the existing listing fallback; no new crawler or LLM-only financial arithmetic |
| US | SEC EDGAR for official issuer registry and filing facts; existing price/news adapters | SEC EDGAR is **not** a live stock-price feed |
| Switzerland/EU/other | Existing exchange/EODHD and issuer-relations evidence adapters | Reporting currency alone never determines market domicile |

The request cannot spoof a market that contradicts retained security metadata. Language changes affect presentation, not thesis criteria or financial units.

## Analytical safeguards

- Duplicate periods and mixed reporting currencies/bases are rejected. Nonconsecutive histories do not produce adjacent-period growth or persistent-cash-flow signals.
- Quarterly YTD subtraction requires explicit fiscal year and quarter; balance-sheet stocks are not subtracted. Missing preceding cumulative periods are not filled.
- ROE, ROA, DSO, DIO and DPO use average balances when available. First-period ending-balance fallbacks and estimated day counts are disclosed. Point-in-time debt/equity uses ending equity.
- Zero or invalid denominators produce null, not infinity. Total liabilities are not mislabeled as interest-bearing debt. CFO minus positive CapEx spend is not automatically FCFF.
- Accounting anomaly thresholds are screening heuristics, not evidence of misconduct or calibrated probabilities. Banks/insurers suppress inappropriate generic liquidity/inventory/liability-ratio rules; other sector context is preserved.
- Every output contains a concise public audit rationale and bounded evidence-confidence score, not private chain-of-thought or probability of investment success.
- The optional scorecard requires all 20 criterion IDs exactly once. Inapplicable criteria have null scores. Supported scores require an exact retained excerpt and sufficient confidence. Unavailable evidence is not poor performance.
- Data quality must be verified and weighted dimensions must have supported scores before a total is returned. The total always requires human review and never changes candidate rank, holdings, weights or orders automatically.

## Review and interruption workflow

1. A write-enabled authenticated account starts a research-only run against an active owned thesis when portfolio-linked.
2. The worker freezes evidence and governed configuration, then runs registered tools.
3. If optional scoring is enabled and statement provenance/durations need review, the run enters `awaiting_approval`; no timeout resumes it.
4. The reviewer confirms the exact retained annual dates, durations and source categories. The route stores review metadata, not replacement financial figures. The original run record is preserved as superseded; the statement tool recalculates on resume.
5. Weak provenance or missing fields still withhold a total after review. Human approval does not invent evidence.
6. Pause/cancel clear the lease and preserve interrupted/completed audit records. Already-sent provider requests cannot be revoked; stale workers cannot publish a result or initiate another step. Deliberate resume/review resets crash-attempt accounting.
7. The final report is a proposal. The existing explicit acceptance route creates a version and preserves prior accepted analyses; research never silently replaces accepted thesis-linked conclusions.

All mutation routes enforce authentication/write permission, same-origin checks, ownership, allowed state transitions, active-thesis checks on continuation and advisory-lock queue capacity. Compare-and-set updates reject racing controls. Configuration snapshots, tool allowlists/budgets, shadow diagnostics and evaluation controls from the latest main branch remain intact.

## Agent Activity Inspector

Company Analysis shows a concise live status: phase, current agent, progress, and the latest meaningful update, alongside the return briefing. Detailed session inspection is in the administrator-only Research Operations activity view. The inspector shows governed tasks, start/elapsed time, registered tool lifecycle, sanitized failures, validation retries, handoffs, reviewable artifacts, source references, data-quality state and model/configuration identifiers, with an expandable audit trail.

Regular company-session reads remain owner-scoped. The explicit platform-admin operations view can inspect sessions across accounts. Observability remains bounded in both paths: raw run inputs, prompts, protected policies, frozen evidence/configuration snapshots, lease identifiers, credentials, signed query strings, raw tool payloads and private chain-of-thought are not exposed. Admin visibility does not change the authority boundary or permit automatic acceptance, weighting or trading.

## Deployment order

1. Review this branch and its generated **`0024_lonely_venom.sql`** migration. Migrations 0022 and 0023 from main are preserved; the earlier local draft migration is not part of the deployment sequence.
2. Run the existing dashboard database migration command against the dashboard's PostgreSQL database. Migration 0024 creates `agent_session_events` with a session foreign key and chronological index. Do not point it at an unrelated worker database.
3. Deploy both the Next.js/dashboard service and the existing finance-capable Railway worker from the same revision. The worker imports the updated shared governance registry and financial runtime. No additional API key is required by this change.
4. Verify existing provider/model credentials and the worker's existing dashboard database connection (`FINANCE_DATABASE_URL` where required by its current configuration). Do not create public/browser-prefixed credentials.
5. Run a Brazilian issuer with coherent historical filings and a thesis with scoring disabled. Verify correct issuer/currency, Portuguese research where requested, statement metrics, limitations and industry modules.
6. Enable optional scoring in a reviewed thesis; start a new run. Confirm the provenance checkpoint, source links, retained figures and quality gate. Unknown/secondary provenance must not produce a total.
7. Pause/resume and cancel an active run. Confirm retained records, no late publication, no duplicate execution and no portfolio mutation. Confirm viewer accounts cannot invoke controls.
8. Delete or replace a linked thesis while a run is paused. Continuation and final acceptance must reject the inactive linkage.
9. Review and explicitly accept an eligible completed report using the existing acceptance workflow. Confirm previous accepted analysis remains in history.

The start flow now includes a pre-execution plan review showing the requested issuer, analysis type, portfolio/thesis scope, research language, selected assumptions, planned research phases and authority boundary. The completed/partial return briefing summarizes validated findings, opposing risks, confidence as evidence coverage, citations, limitations and the next human action. It does not reveal private chain-of-thought or infer approval.

## Verification and known boundaries

Regression coverage includes ratio conventions, YTD flow normalization, invalid currencies/periods, sector suppression, lineage, evidence/scorecard gates, profile locale and market conflict, governance authorization, retained predecessor context, in-flight interruption and authenticated control/financial-review routes. Existing dashboard and worker tests are also retained.

Local unit tests and builds do not prove live provider access, deployed migration success or production worker connectivity. Those require the rollout checks above. Browser verification requires an installed browser runtime; absence is a verification limitation, not a passing UI result.

This implementation adapts the four supplied analytical modules into the existing platform. It does not install their standalone report engines or reproduce every page from the Agentic UX reference. Model-output localization, additional sector policies and real-issuer acceptance testing remain; no numerical accuracy or investment return is guaranteed.
