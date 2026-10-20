# Complementary price evidence and bounded recovery

## Problem and decision

On 2026-10-20 the live AAPL canary found 251 EODHD sessions versus 1,254 Yahoo sessions, with no discrepancy in the overlap. PETR4 had 1,247 shared BrAPI/Yahoo sessions and 978 discrepancy flags (not 978 distinct conflicting days). The current credential's full-history access and the cause of the Brazilian adjustment differences were not established. A provider plan limit is not a missing-data bug that can be repaired by repeating date ranges, reusing demo tokens or manufacturing older prices.

Use complementary evidence, not a blended price. Keep Yahoo and the second vendor's original adjusted series, source URL, currency, identity, retrieval time and content hash together in each immutable snapshot. Do not treat BrAPI `close` as raw: its official historical API documentation says it can already be adjusted. `adjustedClose` remains the return input. No new vendor purchases or credential transfers are included.

## Deterministic evidence contract

`price-reconciliation.v2` preserves v1 identity, source, freshness, order, currency, adjustment-basis and tolerance guards. It adds:

- Anchor normalized levels on the latest **shared** session, never on a missing second-provider date.
- `partial`: at least one adjacent return is compared, all shared levels/returns agree, but the full five-year window is not corroborated. Counts and exact compared date range remain visible. This is not `matched`.
- `disputed`: any normalized-level or daily-return conflict, including with incomplete coverage. No conflict is hidden as a mere coverage shortage.
- `incomplete`: too little adjacent evidence to compare. Primary or secondary gaps never form an apparently corroborated return.
- Counts of agreeing/conflicting adjacent returns, contiguous agreeing-return ranges, maximum differences, and up to five conflict examples. Full discrepancy identifiers and original prices stay in the authenticated snapshot JSON.
- Corporate-action-date correlation is a diagnostic clue from Yahoo's event feed only. It cannot excuse a mismatch, establish the adjustment method, verify the event independently, or lower a tolerance.

Tolerances are unchanged: daily return difference 0.001; rebased level difference 0.005. Source upstream independence remains uncertified even if vendors agree.

An optional dedicated `FMP_API_KEY` enables the official FMP stable dividend-adjusted endpoint for USD US listings only. The provider's FAQ documents splits and dividends. It is a supporting witness, not an automatic replacement for EODHD: at most two fixed-endpoint reads run in parallel (20-second individual timeouts), every successful witness is retained, and **any disagreement vetoes a pass**. A full agreeing witness may corroborate dates outside a partial witness's range; partial histories are never extrapolated or stitched into fabricated data. Failed reads remain visible with sanitized reason codes. No FMP key is sent to EODHD, BrAPI, Alpha Vantage or the browser. A Railway reference can bind the already configured web-service FMP key to its worker without exposing its value. Actual entitlement still requires a live canary.

## Complementary risk diagnostics

`priceSensitivity` computes separate Yahoo and secondary-provider sample annualized volatility (252 sessions) and historical daily VaR95 on **identical adjacent-session pairs**. It does not bridge a missing reference session or missing secondary point. Metrics need at least two paired returns. The result is explicitly diagnostic-only, not a confidence interval, full-history estimate, replacement series, automatic source vote or authorization to calculate a portfolio from disputed prices.

The UI shows coverage before results, keeps provenance progressively disclosed, and uses a semantic comparison table. Disputed histories still have no canonical risk metrics and cannot pass `storedHistory` or Risk Studio's prepared-history gate. `PRICE_RECONCILIATION_REQUIRED=true` on either boundary additionally rejects anything except `matched`. With the existing optional-verification policy, a structurally complete history with `partial` corroboration remains usable with explicit limitations, as single-provider histories already were. No setting is silently changed to claim full verification.

## Recovery

Authenticated, same-origin, edit-authorized history POST accepts optional `refresh: true`. Only this explicit request requeues completed jobs; automatic research completion remains idempotent. Queued/running jobs are reused. At most three claimed attempts per owner/company/issuer/UTC day, including failures and refreshes. Existing lease fencing and snapshot hash/ownership checks remain in force. No migration, deletion or overwrite of existing snapshots is required. A failed refresh does not replace the last saved history. A completed disputed refresh becomes the latest snapshot and blocks risk; older snapshots remain inspectable but are not silently selected to bypass it.

## Release and verification

Build web, worker and the bundled Risk Studio function from the same source. Keep acquisition disabled until all three compatible consumers are deployed successfully; then enable `PRICE_RECONCILIATION_ENABLED=true` on the worker and inspect the read-only AAPL/PETR4 startup canaries. They do not write user workspace data or invoke models. UI fixtures are synthetic, not evidence of signed-in production usability. Public canary logs contain aggregate counts and up to five public-symbol return comparisons, never keys, request URLs with credentials, holdings or full licensed histories.

Rollback: disable worker acquisition, redeploy the previous compatible web/worker artifact and exact saved Risk function source if needed. Disabling future acquisition does not clear a saved dispute or transform partial evidence into verified evidence. Existing snapshots and jobs are additive and need no schema rollback.

Full five-year corroboration still requires a provider credential actually returning the requested adjusted history. BrAPI disputes require authoritative adjustment/event evidence or corrected vendor data before promoting them. The release provides bounded, auditable analysis of these gaps, not a false certification that they disappeared.
