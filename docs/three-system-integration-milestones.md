# Three-System Integration — GPI Milestones (2026-10-10)

Scope: Global Portfolio Intelligence only. USA/SEC and Brazil/CVM. No Swiss coverage or automatic trading. FilingLens and Portfolio Risk Studio repositories/services are unchanged.

## Readiness and ownership (M0)

GPI owns discovery, candidate screening, investment-thesis decisions and review records. FilingLens owns issuer financials, DCF/comps and analyst-approved valuations. Portfolio Risk Studio owns holdings, portfolio accounting, risk, position sizing and returns. GPI must never compute the external indicators.

At baseline: foundation PR #142 was merged and deployed; its public FilingLens read remains disabled pending a producer. FilingLens's approved valuation API is not yet published. Risk Studio has no shared authenticated ledger/API. Preserve the recovery branch recovery/pre-foundation-main-2026-10-09 and old database records. Retire old agentic-api only after checking consumers.

## Milestone status

| Milestone | GPI work | Limit |
|---|---|---|
| M1 | SEC/CVM issuer identity contract and canonical resolver, valuation/portfolio/event typed schemas | Producer implementations pending |
| M2 | Existing public FilingLens fact reader plus approved-valuation consumer | Disabled until provider and credentials |
| M3 | Read-only Portfolio Risk exposure and risk-run adapters; server-configured tenant mapping | Disabled until durable authenticated PRS API |
| M4 | Human review via UI and same-origin API; immutable account-scoped decision + outbox event in one transaction | Records a local handoff, not an external request |
| M5 | Typed event envelope and pending transactional outbox | No sender, subscriber or automatic order execution |
| M6 | Zod contract tests, embedded SQL tests, fail-closed adapter tests | Live provider/staging proofs pending |

## GPI APIs

- GET /api/integration/v1/status — integration readiness flags.
- GET /api/integration/v1/registry — issuer identities from signed-in workspace; unmapped remains explicit.
- GET /api/integration/v1/reviews — private review history scoped to authorized account.
- POST /api/integration/v1/reviews — editor-only, same-origin, bounded request. Requires completed research job, manual explanation, confirmed official CIK/CNPJ identity for analysis requests. Returns delivered:false.
- GET /api/integration/v1/valuation?candidateKey=...&valuationVersionId=... — read approved issuer-matching external valuation only.
- GET /api/integration/v1/portfolio?portfolioId=...&runId=... — read mapped tenant/portfolio exposure and optional risk run only.

Proposed (not deployed) provider endpoints: FilingLens GET /api/integration/v1/valuations/:id; PRS GET /v1/portfolios/:id/exposures and GET /v1/portfolio-risk-runs/:id.

## Release flags — default OFF

FILINGLENS_VALUATION_READ_ENABLED=false. Requires HTTPS FILINGLENS_API_URL and a dedicated FILINGLENS_VALUATION_READ_API_TOKEN.
PORTFOLIO_RISK_READ_ENABLED=false. Requires HTTPS PORTFOLIO_RISK_API_URL, PORTFOLIO_RISK_READ_API_TOKEN, and server-side PORTFOLIO_RISK_WORKSPACE_MAP_JSON mapping GPI account UUID to PRS workspace UUID.
Existing FILINGLENS_READ_ENABLED remains independently disabled until the public financial-snapshot producer is deployed and tested.

Provider adapters perform GET only with server-managed credentials, no redirects, body and request deadlines, strict schema validation and identity checks. A query parameter cannot override tenant mapping. No event transport or external delivery is enabled.

## Release verification

1. Lint, typecheck, unit + embedded PostgreSQL tests, worker build, Next build.
2. Apply migrations/001_foundation.sql and migrations/002_gpi_integration.sql twice on staging and verify no legacy data modifications.
3. Owner/analyst/viewer authorization and cross-tenant tests; idempotent review/outbox behavior; CNPJ/CIK fail-closed.
4. Real authenticated FilingLens and PRS checks in isolated staging after their providers publish compatible contracts; verify invalid/future/stale and partial data, cross-workspace mismatch, expired credentials and outages.
5. Canary-enable each provider independently; monitor, then promote to production. Roll back flags without database deletion.

Milestone completion inside GPI is not equivalent to full integration with the other two applications.
