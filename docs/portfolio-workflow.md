# Three-application portfolio workflow (2026-10-11)

## Architecture decision

Use deterministic server orchestration for the integration. GPI owns account authentication and durable received portfolio snapshots. FilingLens remains the calculation and publication authority for reviewed valuation; Portfolio Risk Studio remains the historical market/risk/allocation authority. No shared database credentials and no extra model calls are required.

Alternatives considered: (1) a separate portfolio database and authentication service adds identity synchronization and operational cost to a currently stateless application; (2) a manager/swarm for data transfer adds latency and cannot establish tenant authorization or numerical truth; (3) typed HTTP requests and authenticated account storage provide deterministic verification with the current services. Choose (3). Keep the existing bounded research manager for narrative research.

### Contracts and gates

- GPI issues a signed workspace capability only to an account editor after issuer confirmation. It includes immutable workspace/reviewer/issuer/listing/ticker, random nonce, issue and expiry times; maximum lifetime two hours. Links carry the capability in the fragment and strip it on arrival.
- Existing single-use corpus handoffs include this capability, so company/year document bundles retain their GPI workspace through FilingLens.
- FilingLens requires explicit approval and sharing consent. It recalculates the accepted assumption ledger; clients cannot submit a per-share output. Immutable versions retain private reviewed financial data, source hash, assumptions and calculation audit. This is an analyst-reviewed analysis, not regulator-certified data.
- A version is accessible only with the server read token AND exact workspace header. No private upload enters the public financial snapshot API.
- GPI re-reads the approved version from FilingLens under the signed-in account scope before persisting it. Only uniquely matched, USD, recently approved versions enter allocation diagnostics.
- Risk Studio accepts a dedicated server token, exact UUID scope, explicit consent, at most ten holdings, USD market series, SPY benchmark and bounded inputs. It calculates historical risk, return contributions and a capped minimum-variance experiment.
- GPI validates response shape, exact holdings/share counts, workspace/portfolio identity, normalized weights and reconciliation of return contributions before saving. Save/read paths scope by account and owner; UUID idempotency keys prevent replay writes and changed-payload reuse.
- Holdings and metrics are retained only after explicit sharing consent, with a quota of one hundred snapshots per workspace. No orders or broker integration.
- Portfolio feedback feeds an editable Research Hub question through an explicit user action. It is a research prompt, not filing evidence.

### Dependencies, budgets and failures

Flow: GPI issuer selection → FilingLens analysis/review → workspace-scoped immutable valuation → GPI verified import → authenticated Risk Studio computation → GPI snapshot/monitoring → Research Hub.
One FilingLens read per imported valuation; one Risk Studio request per risk run; no integration model calls. Provider timeout forty seconds; snapshot refresh sixty seconds; payloads are bounded. Missing prices, failed schemas, changed identity, wrong workspace, stale valuation or provider errors do not produce fabricated results. Snapshot failures and stored history remain visible separately.

### Limits and evidence

Risk is a reconstruction of current holdings, not realized transaction-ledger performance. Return contribution is each reconstructed gain divided by initial reconstructed portfolio value, so contributions reconcile exactly to the lookback return. Value gap compares reviewed per-share value with last aligned close; it has no return horizon and is not an expected annual return. Minimum variance is retrospective, long-only, capped at 45%, requires at least three holdings, and does not optimize expected return or use valuation gaps as forecasts.

BRL/CVM valuations can be imported for research but cannot enter the USD-only risk engine. FX, country/sector classifications, tax lots, transaction-based attribution, broker orders and unattended outbox delivery remain unsupported. Classification coverage is explicitly unclassified; no ticker-to-country or sector guess is stored.

Public financial snapshot repair: explicit CIK/CNPJ regulator lookups now archive their validated public data. Cache misses trigger one bounded regulator fetch per issuer, coalesced across requests with four concurrent refreshes and a failure cooldown. SEC CIK storage uses ten digits. SEC contact remains e.gustavo.tss@gmail.com.

## Deployment

Railway Function source is versioned at `ops/portfolio-risk-function.ts` in GPI. Read the deployed source before updating; deploy the complete reviewed file. App authentication and persistent storage remain in GPI.

New server-only variables:
- GPI/FilingLens: `INTEGRATION_SIGNING_SECRET` (shared random value, minimum 32 characters).
- GPI/FilingLens: `FILINGLENS_VALUATION_READ_API_TOKEN` (dedicated server credential).
- GPI/Risk Studio: `PORTFOLIO_RISK_API_TOKEN`.
- GPI: `PORTFOLIO_RISK_API_URL`, `PORTFOLIO_RISK_READ_ENABLED=true`, `FILINGLENS_VALUATION_READ_ENABLED=true`.
- Risk Studio: `GPI_API_URL`.
Never place these values in source, client bundles, logs or browser storage. Signed short-lived capabilities are the only client-visible authorization artifacts.

Additive GPI migration 004 creates received snapshot and approved valuation tables, plus a nullable corpus handoff capability. FilingLens creates its dedicated immutable valuation table on first protected access. Existing documents and application records are preserved.

Verification includes signature/tamper/expiry checks, review gates, provider auth, return reconciliation, allocation caps, real PostgreSQL-compatible migration replay, account isolation and idempotency. Production deployment status and live checks must be recorded separately from local tests.

