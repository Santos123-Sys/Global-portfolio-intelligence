# Focused implementation audit — 2026-10-02

## Scope and method

Reviewed the production workflow, shared contracts, routes, database writes, components, tests and prior Agentic AI UX design. This is a focused implementation audit, not a claim that every provider or deployment was exercised. Changes reuse Next.js routes, PostgreSQL/Drizzle, the Tool Registry and existing glass-green components. No new orchestration framework or duplicate design system was added.

## Workflow assessment

| Flow | Finding and implementation | Remaining boundary |
| --- | --- | --- |
| Authentication and ownership | Existing authenticated owner scope, read-only account guard, same-origin mutation checks and bounded request bodies retained for Creator routes. | Interviews are shared within the existing owner/workspace model, not private per workspace member. |
| Investor profiling | Added all 11 questions with exact source points and score bands; progressive conversation, saved answers, explicit assessment/scope confirmation and deterministic server verification. | General guide; bond selection and comprehensive suitability are outside listed-equity research. |
| Strategy conversation | Renamed assistant/UI/provider module to Portfolio Creator; mandatory profile in model context, revision-fenced persistence, saved retry, explicit Stop, stalled status and no hidden reasoning. | Provider computation may continue after Stop, but its result cannot publish. No token progress is invented for the synchronous model call. |
| PDF and review | Saved server draft/profile only; local completed extraction, canonical profile constraints, approved snapshot, regenerated PDF. Fixed omitted `manual` flag in recovered review drafts and orphan-source recovery. | Historical pending assistant drafts lacking a profile must be regenerated; imported mandates use their existing document review path. |
| Thesis approval and Discovery | Existing transactional version/source checks, human approval, portfolio destinations, decision audit and queued Discovery transition retained. Serial extraction refresh now preserves action errors and shows retry feedback. | Unsupported markets and private-worker availability remain explicit existing integration limits. |
| Discovery and candidate review | Reviewed source precedence, classification/eligibility, candidate human decision controls and existing progress/outcome reporting from merged main. | Provider health or missing evidence can prevent candidate qualification; no fabricated fallback result. |
| Financial analysis and DCF | Reviewed unified session states, Tool Registry contracts, plan preview, approval gates, pause/resume/cancel/retry, run events and validated outputs. Company page now observes paused/awaiting-review runs and shows recent activity and human-review status. | Financial model/data limitations remain disclosed in existing swarm documentation; this audit does not create new adapters or forecasts. |
| Research Operations | Inspector refresh now recovers after errors and updates when run status changes. List/detail failures are independent; no overlapping polling. | Legacy Discovery, Market Brief and holdings workers do not share the unified financial-session pause/cancel contract. UI does not claim those controls exist. |
| Existing holdings | Serial refresh, retained results and visible automatic-retry feedback replace overlapping interval requests. | Imported holdings remain subject to existing evidence/review gates. |
| Document intelligence | Refresh action always settles with visible error/status. Ingestion jobs now show live state/counts and refresh completed server summaries. RAG exposes evidence retrieval and prevents duplicate submits. Workspace cross-origin rejection now returns 403. | RAG does not restore its prior visible chat thread after a browser reload; persisted conversation/data remains backend-owned. |
| Portfolio, allocation and controls | Reviewed accepted-analysis gates, position linkage, seven weight methods, allocation/risk and Investment Control interfaces. No alternate portfolio-writing path was added. | Suggested stock/bond mix describes investor profile; security weights remain the existing equity allocation engine's responsibility. |
| Admin/settings | Existing provider health, settings, security, decision/thesis history and operations placement retained. Technical Gemini provider names remain correct in administration. | This release needs migration and live credential/provider checks. |

## Agentic UI design coverage

The relevant financial-research flows already provide plan preview, scope, current stage, evidence/results, interruption controls, approval handoff and return briefing. This audit closes confirmed recovery/status gaps rather than duplicating those surfaces. Portfolio Creator now distinguishes saving an answer, model work, failed/retryable work, stopped work, PDF generation and review readiness. Questionnaire completion uses actual saved counts. Confidence, deterministic profile score and operational progress remain distinct. Human approval is never inferred from elapsed time. Existing reduced-motion handling, native controls, live statuses and production styling are retained.

Private integrations expose their actual queued/running/completed/failed state; enabling pause/resume requires a worker cancellation protocol rather than a cosmetic button. Raw model reasoning and provider errors are not exposed to users.

## Verification and deployment

Automated verification covers the original score arrays and all allocation boundaries, incomplete/invalid answers, profile confirmation/deviation rules, recomputation against forged scores, sequential state transitions, profile gates on API/model/PDF, saved retry without duplicate messages, stale writes and late completion after Stop. Browser tests exercise desktop and mobile, reload mid-profile and after a proposal, model failure/retry, PDF download, production review and approval, and horizontal overflow. Existing workflow suites are also run. A real sample PDF was rendered and visually inspected.

Final commands: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build:agentic`, `npm run build`, `npm run test:e2e`, and `git diff --check`. See PR verification results for exact counts.

Deployment requires dashboard migration 0025 before the new app version, then redeployment. No PostgreSQL server or live Railway environment was available in this workspace; migration execution, real Gemini completion, actual downstream provider access and live portfolio creation must be verified after deployment. Automated browser/API tests use controlled data rather than paid live research calls.
