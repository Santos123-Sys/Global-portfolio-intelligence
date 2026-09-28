# Portfolio weight planner

Implemented on top of main `bc287d0` (PR #97). The supplied README and integration
specification are preserved alongside this document; the corrections below take
precedence over those unmodified source documents.

## User flow

Allocation → Data and computation settings → upload native-currency total-return
CSV and identify its source → compute proposal → compare eight methods and 1/N
benchmark → accept, choose a method, or enter custom values → review normalized
weights and warnings → confirm target. Defer makes no mutation.

A target is planning data, separate from observed holdings and trade records.
No trades, quantity changes, or market-value/observed-weight changes are made.
The latest confirmed audit is the authoritative target; the UI compares it to
recorded holdings. Computation failures preserve that target.

## Runtime and deployment

1. Back up the dashboard PostgreSQL database. Run the normal `npm run db:migrate`
   with migration `0015_portfolio_weights` before serving the new dashboard.
2. Deploy the updated existing `services/filings_python/Dockerfile`. The image
   includes the numerical modules and pinned NumPy/Pandas/SciPy/scikit-learn.
   No new service is required if the financial-extraction service is deployed.
3. Configure the dashboard's existing `FILINGS_API_URL` and matching
   `FILINGS_INTERNAL_TOKEN` (at least 32 characters) on both services. Keep the
   Python service private. Weight computation does not use an OpenAI API key.
4. Deploy the dashboard. Its compute request has a 110-second timeout and its
   route allows 120 seconds. Confirm the hosting plan supports this duration.
   The Python service limits computation to one active request per process and
   responds with a retryable busy error rather than accumulating jobs.
5. In staging, use real, provider-exported dividend-adjusted total-return prices
   for 2–12 current holdings, all in the portfolio's native currency. CSV headers
   are exact holding tickers. This release does not silently reuse `price_history`
   because that table does not establish dividend adjustment. Data-provider
   integration is not automatic: the operator uploads and attests the CSV.
6. Validate actual data rights/adjustments and currency, then compute; check that
   all eight rows and the 1/N benchmark appear. Confirm, reload, export the audit
   snapshot, and replay it. Repeat with another account to verify isolation.
7. Exercise defer, warnings, cap breach, stale proposal, changed holdings,
   simultaneous confirmations, service outage, and database rollback behavior.
   Previous target must survive every failed computation/confirmation.

Rollback: revert dashboard/service deployments. The additive audit table can
remain; no pre-existing tables or observed position weights were changed. Do not
drop audit records to roll back the UI.

## Audits and replay

Each proposal stores owner, actual actor, native currency, original CSV, SHA-256,
data-source reference, holdings identity hash, previous confirmed-decision ID,
complete config, numerical engine version, dependency versions, asset order,
weights, out-of-sample metrics and stability results. Explicit confirmation stores
`finalize`'s record verbatim, confirmer, timestamp and acknowledged warnings.
Targets are serialized using a portfolio-row lock and optimistic previous-target
ID. A confirmed proposal cannot be written a second time. Proposals expire after
seven days, and a changed asset universe/currency requires a fresh computation.

Download through Allocation → Audit and reproducibility → Download audit snapshot.
Reproduce without network calls or portfolio writes:

```bash
pip install -r services/filings_python/requirements.txt
python -m services.filings_python.replay_weights portfolio-weights-RUN_ID.json
```

Use the recorded engine version and dependency versions. Replay checks the price
hash, dependencies, method weights and winning method. NumPy/SciPy floating-point
results can vary slightly across hardware; the replay weight tolerance is 1e-7.
Do not send audit exports to third parties; they contain the user's portfolio data.

## Corrections to the supplied package

- `finalize(None)` defers. It no longer labels an implicit acceptance as human.
- All methods and custom confirmations enforce exact asset membership, finite
  nonnegative weights, full investment and the configured feasible per-asset cap.
  Optimizer failure aborts the proposal instead of silently accepting `r.x`.
- HRP builds correlation from covariance and standard deviations, not correlation
  between the rows of the covariance matrix. HRP projects onto the capped simplex;
  RiskParity solves within the cap, so neither claims unconstrained exact parity.
- Half-Kelly is constrained quadratic growth optimization with fraction 0.5,
  fully invested and without leverage/cash. This replaces the original fraction
  that cancelled when the vector was normalized. It is not unconstrained Kelly.
- Black–Litterman uses a disclosed equal-weight equilibrium prior (delta 2.5,
  tau 0.05) with no investor views. The supplied default invented a +2% relative
  view between assets at indices 0 and 2 and crashed for two-asset portfolios.
  A user-defined views editor is not part of this release.
- Estimation retains log returns and Ledoit–Wolf shrinkage. Backtesting converts
  each asset to simple returns before aggregation, drifts asset weights daily,
  measures turnover against the drifted weights and charges one-way costs on
  actual traded notional, including the initial purchase. Final partial segments
  are included. Drawdown includes the initial NAV of 1.
- All methods use identical seeded bootstrap perturbations. Failed samples abort
  the run rather than biasing stability by silently dropping them.
- Ranking retains all eight methods with drawdown eligibility. If every method
  breaches the historical constraint, the recommendation is explicitly flagged.
  Alternative-method breaches and untested custom weights require acknowledgement.
- Price gaps are rejected, not forward-filled. Dates must be unique and valid,
  prices finite/positive, with sufficient history and a recent ending date.

## Interpretation limits

The ranking score is the supplied transparent heuristic; its objective metrics
have different scales and penalty calibration has not been empirically validated.
Balanced and max_sharpe share the same scoring objective. The winning method was
selected on the displayed walk-forward results; those results are not a fresh,
independent test of the selection rule. IID bootstrap does not capture regimes or
serial dependence. The 252-day convention assumes daily observations. No model
here establishes future drawdown limits or covers taxes, execution liquidity,
FX conversion, sector/group caps or fund look-through. Optimizer caps are separate
from the existing monitoring governance policy, which remains advisory.

## Verification

- Python numerical/contract regression tests and the full supplied synthetic demo.
- Dashboard unit suite, route guard tests, TypeScript and ESLint.
- Desktop/mobile Playwright test added to CI, including defer and explicit confirm.
- Browser execution in the authoring environment was blocked by OS socket
  permissions; visual/browser behavior remains a CI/staging validation gate.
- Production database migration, live provider data, hosting latency and real
  confirmation persistence were not exercised by the local mocked route tests.
