# Brazilian source validation and controlled deployment

## Separate the release decisions

A green CI run authorizes the tested code artifact, not Brazilian data eligibility.
`npm run market:brazil:check` performs bounded serial provider and stateless risk-consumer checks.
It exits 1 on configuration, catalog, source, assessment or consumer failure. A pass
covers only the explicitly selected sample (maximum eight exact mapped seed tickers).
`marketCertified` is always false. Worker startup uses the same report in observational
mode: an unsuccessful optional canary does not terminate unrelated research jobs.
Use the final `brazil_market_release.gate`, never container SUCCESS or an individual
catalog-discovery log, as the selected-data promotion decision.

The report contains the producing commit, stages, bounded error codes, counts,
up to five unresolved public event/date identifiers per symbol, and consumer
snapshot/hash receipts. It contains no token, raw vendor response, holding or account.
Catalog receipts and unmapped/review-required listings remain distinct from certification.

## Reviewed calculation v3

`brazil-gross-entitlement.v3` processes the same immutable v2 source envelope and
adds only exact issuer reviews in `src/lib/market/brazil-issuer-event-reviews.ts`:

- VALE3 / CNPJ 33592510000154 / BRVALEACNOR0: the observed 2022-03-09
  vendor gross 3.701840165 differs from the issuer's published final dividend
  3.719256588 (paid 2022-03-16). The issuer value may supply the reconstructed
  entitlement only when the exact single vendor event matches record/ex/payment,
  label, ISIN and observed amount, and Yahoo independently corroborates the final
  value within the existing 0.000002 tolerance. BrAPI's original amount still
  explains BrAPI's own adjustment factors. Neither original is overwritten.
- ITUB4 / CNPJ 60872504000123 / BRITUBACNPR1: missing vendor bonus ex-dates
  can use the issuer's explicit 2025-03-18 (factor 1.1, record 2025-03-17) and
  2025-12-26 (factor 1.03, record 2025-12-23) notices. Exact identity, event label,
  factor and record date are required; Yahoo factor and reference-session alignment
  remain mandatory. Unknown/changed dates and other classes receive no exception.

Source URLs and retrieval SHA-256 receipts (reviewed 2026-10-21) are versioned
beside the rules and emitted in the reconstructed issuer-review receipts. These
reviews do not prove point-in-time availability or certify another issuer.
Original null prices, other cash alignment errors, unsupported subscriptions,
unknown reorganizations and provider denials still block use. No tolerance widened.

## Ordered release procedure

1. Record current web/worker SHAs, successful deployment IDs, Risk Function deployed
   source and its SHA-256. Preserve that compatible set for rollback. Inspect staged
   changes and effective flag configuration without exposing values.
2. Run the full CI `verify` job on the final PR head; review skips and documented
   security exceptions. Never rebuild a lockfile during CI to hide a failing gate.
3. Prevent unverified main pushes from autodeploying: enable Railway Wait for CI when
   supported, or pin each production service to its last validated commit using the
   source connector. A pinned service must be deliberately advanced after successful
   merged-commit CI; it no longer follows arbitrary branch pushes.
4. Deploy the shared Risk Function built by the successful CI run. Read back deployed
   bytes and compare SHA-256; wait for SUCCESS. Then merge the reviewed PR and verify
   full CI on the exact merge SHA. Advance pinned production web and worker to that
   same successful SHA. Do not use redeploy of an old image to claim new code shipped.
5. After compatible consumers are live, enable `BRAZIL_MARKET_CANARY_ENABLED=true`
   once, with `BRAZIL_MARKET_CANARY_SYMBOLS=VALE3,ITUB4,BBDC4` (or an explicitly
   reviewed sample). Inspect the final structured gate and every selected result.
   A source failure blocks data promotion but does not invalidate a safety-code deploy.
6. Disable the one-shot canary after capturing results; keep the ongoing per-dataset
   deterministic assessment. Keep legacy repair flags off. Do not mass-refresh account
   data, reset retry attempts, overwrite snapshots or enable a strict global
   `PRICE_RECONCILIATION_REQUIRED` policy before proving actual coverage.
7. Expand through independently mapped and validated instruments. A complete-market
   claim additionally requires an authoritative universe comparison, inactive/delisted
   scope, classification of fractional-board aliases, entitlement proof, and successful
   source/consumer evidence for every instrument in the declared scope. A small sample
   cannot satisfy that requirement.

## Recovery

If the new code breaks service, restore the saved compatible Risk Function and pinned
web/worker artifacts. Disable one-shot checks; use the existing acquisition/normalization
controls only with explicit degraded-state monitoring. Disabling acquisition does not
remove saved disputes or mark single-provider data independently verified. Quarantine
and recompute affected financial outputs separately; never erase immutable originals.

## Primary references inspected

- https://www.vale.com/pt/dividendos-dividas-e-debentures (final amount/payment)
- https://www.vale.com/pt/w/vale-anuncia-distribuicao-de-remuneracao-aos-acionistas-e-cancelamento-de-acoes-em-tesouraria/-/categories/718967 (record/ex-date; preliminary amount can change)
- https://www.itau.com.br/download-file/v2/d/42787847-4cf6-4461-94a5-40ed237dca33/381dd2fe-c509-52de-0470-bca329d4449b?origin=1 (2025-02-05 notice)
- https://www.itau.com.br/download-file/v2/d/42787847-4cf6-4461-94a5-40ed237dca33/8154a24f-7f95-d406-706a-da4535fd5f0f?origin=2 (2025-12-18 notice)
- https://docs.railway.com/deployments/github-autodeploys#wait-for-ci
