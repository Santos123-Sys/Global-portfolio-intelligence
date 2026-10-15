# Investment systems audit — 15 October 2026

Status: baseline complete; remediation in progress. Synthetic tests are distinguished from production verification throughout.

## System map and authority

GPI owns authenticated workspaces, research and saved portfolio snapshots. FilingLens owns filing evidence and reviewed valuation publication. Portfolio Risk Studio owns deterministic portfolio calculations; its deployed Railway functions are tracked under GPI ops. Signed, expiring handoffs bind issuer and workspace. Valuation publication recomputes server-side and sends an authenticated notification to GPI. GPI sends explicitly confirmed holdings to Risk Studio and validates the returned result before persistence. No orders are submitted. US SEC and Brazilian CVM are the filing coverage; CHF is a reporting currency, not Swiss filing coverage.

## Verified baseline

GPI main: 2a1f16ee7325a5fdb8dd72e96a6f44eef069fd83. FilingLens main: 2588799ee346342754c7ae21b6f69da04acf056c. Railway production dashboard and FilingLens deployments match these commits. Risk backend deployment de093b6e-73da-466e-99c1-6af3bfdf5da3; frontend 923e9d0c-63f5-4a13-a0ca-8c324834c728.

GPI: 142 tests passed, one skipped; typecheck and lint passed; three browser tests passed (including 390/1440 widths). FilingLens: 319 tests passed; typecheck and production build passed; production dependency audit found no reported vulnerabilities. FilingLens lint has 34 errors and two warnings and CI currently tolerates lint failure. Its main bundle is 1,644.29 kB (535.04 kB gzip); this is a build measurement, not an observed runtime latency.

Existing GPI PR 155 repairs the signed-in integration fixture and exercises real publication, notification, import, isolation and logout with synthetic evidence. Its cross-app test passed against the checked-out FilingLens main (7.39 seconds). It must be reviewed and merged independently; this audit branch initially includes that prerequisite.

## Prioritized findings

| Priority | Evidence | Impact and action |
|---|---|---|
| High | FilingLens scheduled acquisition run 38543366518, job 115783307964: official SEC CompanyFacts returned 403 after successful contact loading and filing discovery | Acquisition remains unavailable. Preserve diagnostic artifacts and sanitized failure receipts; do not bypass SEC denial or retry aggressively. Provider access recovery remains external. |
| High | RiskResult validates allocation sum/cap but not unique, complete holding identities; runPortfolio does not compare response runId | Reject misattributed allocations and responses from another calculation before durable storage. Add adversarial regression tests. |
| Medium | PortfolioHub retains consent when holdings, lookback or risk-free assumption changes; saved results appear alongside editable inputs without clear calculation separation | Reset consent on every shared-input edit and explicitly label saved results as historical snapshots. Store request assumptions with new snapshots. |
| Medium | Scheduled artifact upload uses implicit success condition | A failed acquisition skips uploading available evidence. Run upload after failure without hiding original failure. |
| Medium | FilingLens lint failures and tolerated CI gate | Existing quality debt; inventory separately rather than broadly rewriting unrelated application code. |
| Low | Risk Studio footer contradicts enabled integration header | Verify deployed source before any function edit; defer if unrelated release risk outweighs text improvement. |

## UX acceptance specification

Editing holdings, portfolio name, currency, lookback or risk-free assumption invalidates sharing consent immediately. Saving requires renewed consent. Saved output identifies its historical nature, recorded assumptions and holdings; editing inputs never implies recomputation. Existing snapshots without recorded assumptions disclose that limitation. Busy operations retain a visible working state. Failures preserve user inputs and explain retry availability. Publication continues to require explicit reviewed valuation approval. No autonomous publishing or trading is introduced.

## Data, RAG and operational boundaries

Existing valuation server recomputation, issuer metadata checks, bounded request bodies, exact excerpt retrieval fixtures, concurrency limits and account isolation were inspected. No vector database or new model provider is justified by this evidence. Existing retrieval benchmarks test span coverage on public/synthetic fixtures; they do not establish model answer accuracy or production recall. A provider 403 is not a successful ingestion. Authenticated production GPI journeys require a signed-in browser session; isolated browser tests cannot substitute for that evidence.

## Release and rollback

Merge only after targeted regressions, repository checks and CI. GPI rollback reference: deployment 3ff6d223-7d6c-4c41-982c-ae3269e9b21b at baseline commit above; prior rollback-capable deployment 03c7047e-884f-4696-929d-a67dca33373d. FilingLens rollback baseline: d2cc7b17-b4ce-401e-97c2-1fb7cc1afe14. Changes use additive JSON metadata and require no schema migration. Verify deployed commit and health after merge. Never report a queued deploy as live validation.

## Remediation verification

Implemented allocation identity validation, response run-ID binding, additive saved calculation assumptions, consent invalidation on all shared-input edits, and explicit historical snapshot/holdings display. Regression tests cover duplicated and unknown allocation symbols and mismatched response IDs. Browser checks cover renewed consent after holdings, lookback, rate, currency and name changes at 390 and 1440 pixels.

GPI post-change: all 143 tests passed including the real cross-app implementation with isolated storage; production build and typecheck passed; lint has zero errors and one pre-existing workbench apostrophe warning. FilingLens post-change: all 320 tests and TypeScript check passed. Acquisition now writes progress/failure receipts containing only allowlisted fields and archives available evidence after failure; failure remains failure and no provider retry was added.

Both deployed Risk Studio function sources exactly match the tracked GPI files (backend 59,469 characters; frontend 84,835 characters); neither has pending staged changes. No Risk Studio deployment is needed for these GPI boundary changes.

Retrieval evaluation: 100 local iterations per fixture. All 10 expected spans across four positive cases were retained; the negative fixture expected zero spans. p95 CPU times: public Apple 0.065 ms, SEC contents/body 3.814 ms, CVM contents/body 6.321 ms, separated SEC sections 3.341 ms, missing evidence 0.150 ms. These are local excerpt preparation measurements, not hosted API latency or answer quality, and no retrieval improvement is claimed.

PR 155 merged as 81a661580c8e75c8ef07bf455128aa00f00f082c after successful verify CI. Its fixture implementation was independently exercised against current FilingLens code.
