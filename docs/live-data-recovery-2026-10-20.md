# Live data recovery and browser acceptance

## Failure and repair

The two Yahoo hosts returned the same incomplete BOVA11.SA series: missing adjusted and raw closes on 2025-10-24 and 2026-10-19. PETR4.SA had 1,247 complete observations. The broad Ibovespa index (^BVSP) returned complete observations for the same five-year window. New Brazilian requests use its session dates and retain its exact source URL. Legacy BOVA11 snapshots remain readable. No issuer price is invented, filled or replaced. The reference remains a vendor-sourced index proxy, not an official B3 calendar. Invalid index observations still fail closed.

Independent adjusted-price acquisition now supports BrAPI v2 for eight pinned CVM issuer/listing identities, and EODHD for US symbols when its dedicated credential or explicitly named generic EODHD configuration exists. Alpha Vantage remains supported. Credentials are never guessed or tried across vendors. BrAPI symbol changes, wrong intervals and wrong issuers fail closed; null adjusted prices never fall back to close. All providers use the complete-coverage, level and return checks. Live entitlement and agreement must pass before a dataset is called independently verified. Vendor upstream independence is not certified.

Specifications inspected: https://brapi.dev/docs/acoes/historico and https://eodhd.com/financial-apis/api-for-historical-data-and-volumes . B3 raw quotations are not substituted for an adjusted series: B3 states its historical quotations do not adjust for distributed corporate benefits.

## Production browser acceptance before this release

Using the existing signed-in browser and isolated real Chromium fixture, the automated operator observed these server receipts on 2026-10-20 (UTC):

| Receipt | Time |
| --- | --- |
| Initial frame | 09:01:01 |
| Exclusive takeover | 09:01:41 |
| Controlled report navigation completed | 09:02:38 |
| Reload recovered the same report/run | between 09:04 and 09:05 |
| Resume after fresh observation | 09:05:22 |
| Exact passage retained | 09:06:04 |
| Stop acknowledged and browser closed | 09:07:06 |

Replay was inspected with input disabled; canvas rendering was visually inspected. The display-confirmation button was submitted by the automated acceptance operator through the user's session at 09:08:37, not an independently observed human. Its stored field is named `displayConfirmedByUser`; that label is not independent human feedback. All six checks subsequently read Recorded. This is one completed production journey, not a reliability estimate. No model calls, private login capture, financial publication or corpus writes occurred. The fixture's missing UTF-8 response declaration was corrected.

Evidence: [complete acceptance](evidence/browser-production-acceptance-2026-10-20.png), [canvas](evidence/browser-canvas-2026-10-20.png).

## Release and rollback

Run regression checks, typecheck, lint and builds, then full CI. Deploy the bundled Risk function with web/worker because assessment is shared. Enable independent acquisition on the worker; the startup canary logs provider, outcome and counts without credentials or bodies. `PRICE_RECONCILIATION_REQUIRED` must wait for proven coverage. Failed acquisition preserves prior snapshots. Disable `PRICE_RECONCILIATION_ENABLED` to stop secondary calls; snapshots are never relabeled retroactively.
