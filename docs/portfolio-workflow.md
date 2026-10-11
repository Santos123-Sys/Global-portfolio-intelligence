# Three-application portfolio workflow (2026-10-11)

## Architecture decision

Use deterministic server orchestration for the integration. GPI owns account authentication and durable received portfolio snapshots. FilingLens remains the calculation and publication authority for reviewed valuation; Portfolio Risk Studio remains the historical market/risk/allocation authority. No shared database credentials and no extra model calls are required.

Alternatives considered: (1) a separate portfolio database and authentication service adds identity synchronization and operational cost to a currently stateless application; (2) a manager/swarm for data transfer adds latency and cannot establish tenant authorization or numerical truth; (3) typed HTTP requests and authenticated account storage provide deterministic verification with the current services. Choose (3). Keep the existing bounded research manager for narrative research.

### Contracts and gates

- GPI issues a signed workspace capability only to an account editor after issuer confirmation. It includes immutable workspace/reviewer/issuer/listing/ticker, random nonce, issue and expiry times; maximum lifetime two hours. Links carry the capability in the fragment and strip it on arrival.
- Existing single-use corpus handoffs include this capability, so company/year document bundles retain their GPI workspace through FilingLens.
- FilingLens requires explicit approval and sharing consent. It recalculates the accepted assumption ledger; clients cannot submit a per-share output. Immutable versions retain private reviewed financial data, source hash, assumptions and calculation audit. This is an analyst-reviewed analysis, not regulator-certified data.
- A version is accessible only with the server read token AND exact workspace header. No private upload enters the public financial snapshot API.
- GPI re-reads the approved version from FilingLens under the signed-in account scope before persisting it. Uniquely matched USD/BRL versions approved within ninety days enter allocation diagnostics after dated conversion to the selected portfolio currency. B3 listings use market symbols such as PETR4.SA; their GPI issuer mapping remains BVMF:PETR4.
- Risk Studio accepts a dedicated server token, exact UUID scope, explicit consent, at most ten holdings, verified quote currencies, SPY benchmark and bounded inputs. It converts every historical observation, including the benchmark, into the selected base currency before calculating historical risk, return contributions and a capped minimum-variance experiment.
- GPI validates response shape, exact holdings/share counts, workspace/portfolio identity, normalized weights and reconciliation of return contributions before saving. Save/read paths scope by account and owner; UUID idempotency keys prevent replay writes and changed-payload reuse.
- Holdings and metrics are retained only after explicit sharing consent, with a quota of one hundred snapshots per workspace. No orders or broker integration.
- Portfolio feedback feeds an editable Research Hub question through an explicit user action. It is a research prompt, not filing evidence.

### Dependencies, budgets and failures

Flow: GPI issuer selection → FilingLens analysis/review → workspace-scoped immutable valuation → GPI verified import → authenticated Risk Studio computation → GPI snapshot/monitoring → Research Hub.
One FilingLens read per imported valuation; one Risk Studio request per risk run; no integration model calls. Risk provider timeout sixty seconds; reference requests twelve seconds; classification stage eighteen seconds with two workers. Payloads are bounded. Missing prices, failed schemas, changed identity, wrong workspace, stale valuation or provider errors do not produce fabricated results. Snapshot failures and stored history remain visible separately.

### Limits and evidence

Risk is a reconstruction of current holdings, not realized transaction-ledger performance. Return contribution is each reconstructed gain divided by initial reconstructed portfolio value, so contributions reconcile exactly to the lookback return. Value gap compares reviewed per-share value with last aligned close; it has no return horizon and is not an expected annual return. Minimum variance is retrospective, long-only, capped at 45%, requires at least three holdings, and does not optimize expected return or use valuation gaps as forecasts.

FX uses ECB daily reference rates through Frankfurter's provider-specific v2 endpoint (https://frankfurter.dev/). Each historical observation uses its last available reference rate dated on or before the price date, at most seven days old; missing rates stop the run. Local prices, normalized quote currencies (including GBP pence), FX dates, rates and source metadata remain in the snapshot. USD, BRL, EUR, CHF, GBP, CAD, AUD, JPY, HKD, CNY, SEK, NOK, DKK, NZD, SGD, INR, MXN and ZAR are supported when ECB and market history are available. Currency weights measure quote-currency exposure, not the issuer's economic currency sensitivity.

Classification references derive exclusively from GPI's selected account company list. SEC submissions provide SIC industry and principal-office country (https://www.sec.gov/search-filings/edgar-application-programming-interfaces); SIC divisions follow the OSHA 1987 manual (https://www.osha.gov/data/sic-manual/). CVM cadastro supplies SETOR_ATIV and PAIS (https://dados.cvm.gov.br/dataset/cia_aberta-cad). SEC listing/CIK must match the fetched identity. CVM rows must match CNPJ and be active; agreeing duplicates are accepted, conflicting rows rejected. Principal-office country is not revenue geography. SIC and CVM activity classifications retain their separate names; they are not represented as GICS equivalents. Unknown weights are retained as Unclassified with measured coverage. Reference responses are cached for one hour; original retrieval times are preserved. SEC request starts are serialized at 150 ms intervals and identify e.gustavo.tss@gmail.com.

Tax lots, transaction-based attribution in the connected risk endpoint, broker orders and unattended outbox delivery remain unsupported. The separate Portfolio Studio transaction-accounting frontend remains intact and now passes the chosen base currency with its explicit holdings handoff.

Public financial snapshot repair: explicit CIK/CNPJ regulator lookups now archive their validated public data. Cache misses trigger one bounded regulator fetch per issuer, coalesced across requests with four concurrent refreshes and a failure cooldown. SEC CIK storage uses ten digits. SEC contact remains e.gustavo.tss@gmail.com.

## Deployment

Railway Function sources are versioned at `ops/portfolio-risk-function.ts` and `ops/portfolio-risk-web-function.ts` in GPI. Read the deployed source before updating; deploy the complete reviewed file. The existing transaction-accounting frontend retains its browser dataset and offers an explicit current-holdings handoff to GPI. Synthetic demos are blocked; only symbols/quantities enter the handoff, and GPI requires a separate review before submitting them. App authentication and persistent received snapshots remain in GPI.

New server-only variables:
- GPI/FilingLens: `INTEGRATION_SIGNING_SECRET` (shared random value, minimum 32 characters).
- GPI/FilingLens: `FILINGLENS_VALUATION_READ_API_TOKEN` (dedicated server credential).
- GPI/Risk Studio: `PORTFOLIO_RISK_API_TOKEN`.
- GPI: `PORTFOLIO_RISK_API_URL`, `PORTFOLIO_RISK_READ_ENABLED=true`, `FILINGLENS_VALUATION_READ_ENABLED=true`.
- Risk Studio: `GPI_API_URL`.
Never place these values in source, client bundles, logs or browser storage. Signed short-lived capabilities are the only client-visible authorization artifacts.

Additive GPI migration 004 creates received snapshot and approved valuation tables, plus a nullable corpus handoff capability. FilingLens uses its existing privileged schema migrator and `ops/phase3-reviewed-valuations.sql` to create the immutable valuation table. The application database user retains only data privileges and never creates tables. Annual regulator labels such as FY2025 remain labels, with no invented calendar period end. Existing documents and application records are preserved.

Verification includes signature/tamper/expiry checks, review gates, provider auth, return reconciliation, allocation caps, real PostgreSQL-compatible migration replay, account isolation and idempotency. Production deployment status and live checks must be recorded separately from local tests.

The cross-application approval verification runs actual password/session, account authorization, GPI handoff and import routes, FilingLens deterministic publication/read routes, and durable risk feedback storage. It uses two isolated PGlite SQL engines, a MySQL-compatible connection transport adapter, and synthetic market/financial inputs. CI checks out the pinned FilingLens implementation. Authentication and API routes are not mocked; market transport is synthetic. This is API integration verification, not evidence of a signed-in production browser journey.

Risk Studio exposes rate-limited public reference readers at `/api/fx?from=BRL&to=CHF&date=YYYY-MM-DD` (bounded to the most recent 1,200 days) and `/api/classification?symbol=AAPL` (only configured verified issuer identities). They return public source data and provenance, never holdings, account records or approved private valuations. Live release checks use these readers to verify source availability; the portfolio computation endpoint still requires its dedicated server token.

