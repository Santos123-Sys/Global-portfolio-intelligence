# PETR4 gross-entitlement reconstruction

## Decision and scope

`BRAZIL_HISTORY_NORMALIZATION_ENABLED=true` enables a pinned PETR4 / CNPJ
33000167000101 / ISIN BRPETRACNPR6 path. Other instruments retain their existing
contracts. This is historical risk research, not trading, realized performance,
tax advice, forecast validation or a point-in-time backtest.

The previous requirement for an entirely new five-year adjusted-price feed was
broader than necessary. Compare the original **raw** closes first. On the observed
2021-10-20–2026-10-19 window, Yahoo and BrAPI agree within R$0.005 on 1,224 of
1,247 closes. Cota B3's public query corroborates BrAPI on all 23 disagreements.
The relay is not an official B3 API, and upstream independence is not certified.

No B3-site scraping, new purchase, account creation, credential extraction,
ADR conversion, interpolation, averaging or tolerance widening is used.

## Sources and deterministic rules

- BrAPI historical and dividends v2 endpoints, `includeRaw=true`, exact identity,
  daily interval; existing server credential when configured. BrAPI documents
  PETR4 as an open test instrument. Never extrapolate this access to another symbol.
  `BRAZIL_HISTORY_BRAPI_PUBLIC=true` explicitly selects the documented public
  PETR4 mode before either request, without changing the configured credential
  used by other integrations. There is no anonymous retry after a denied request.
  Source: https://brapi.dev/blog/acesso-gratuito-ilimitado-acoes-teste-brapi .
- Cota B3's public POST form at https://cotab3.com.br/cotacoes; exact ticker echo,
  table shape, completed session dates, positive cent prices, 3 MB bound. No key
  is sent to this source. All reads share a 20-second deadline. BrAPI requests
  run serially, with a 1.1-second pause before the cash request. At most one
  identical BrAPI GET is retried after HTTP 429: honor a valid Retry-After up
  to five seconds, or use two seconds when absent. Longer/invalid delays stop
  the acquisition. Credentials, mode and endpoints never change during retry.
- Issuer exception receipts are versioned in `brazil-event-reviews.ts`.
  They distinguish the 2022 April SELIC update, incomplete 2022 November Yahoo
  entitlement, updated 2023 November principal, 2024 December cash classification
  duplication and 2025 December principal versus later monetary updates.
- The issuer's 2024-06-11 update identifies the real June record date for cash
  also present under a superseded May record. The May alias is excluded only if
  the exact payment/category/amount exists under the reviewed June record.

Raw closes require original-feed agreement or relay confirmation of BrAPI when
the originals disagree. A contradictory third quote blocks use. A missing
relay quote can never resolve an original-feed disagreement. Identical relay
duplicate rows are counted in the receipt; conflicting duplicates reject the
evidence. In the observed response, 22 relay dates are absent and 21 identical
duplicates occur; those absent dates have agreement between both original raw
feeds. These limitations are shown, not converted into full relay coverage.

Cash events must have the exact ISIN, record/ex-session alignment and positive
finite amounts. Gross cash totals require Yahoo/BrAPI agreement within 0.000002
BRL, or an exact versioned issuer exception. Novel mismatches block use. The
2024 December exception additionally binds the four observed payment/category
records. Unsupported splits, unknown event types, unknown ex-dates, duplicate
cash records and changed exception inputs fail closed.

Forensic checks reproduce every vendor return from that vendor's raw close and
cash factor. BrAPI candidate factors 0, 0.15 and 0.175 describe observed vendor
adjustments; they are not assumptions about a user's tax. The residual bound is
0.00005, tighter than the unchanged original return tolerance of 0.001. A date
or category label alone cannot resolve a numerical discrepancy.

Risk uses a separately reconstructed gross-entitlement adjusted series: prior
closes multiply by `1 - gross entitlement / previous raw close` on each ex-date.
Withholding and separately labelled monetary income are excluded. The April
2022 principal is separated using the issuer notice because the vendor combined
it with SELIC. This is a consistent declared-entitlement convention; it is not
actual cash paid or proof that all historical revisions were available then.

## Integrity and consumers

Original Yahoo rows, original BrAPI adjusted rows, source hashes and the original
reconciliation remain in the immutable history payload. Raw quote and cash
evidence is separately stored in `brazilEvidence`. `assessHistory` recomputes all
receipts and `calculationRows`; caller-supplied status/decisions are never trusted.
The original 54 adjusted-return conflicts are retained as source facts.

Only a verified reconstruction with no other quality issue can feed risk.
GPI's strict read and the bundled Risk Studio consumer enforce the same rule.
Risk Studio consumes `quality.calculationRows`, never silently relabels the
original Yahoo adjusted prices. A blocked reconstruction has no canonical
metrics. Existing snapshots are not rewritten; refresh creates a new hash.

## Verification and release

- Synthetic gross/net cash, third-quote loss, contradictory quote, duplicate,
  issuer/URL/freshness, cash revision, split and unexplained-factor tests.
- Published issuer amounts test the financial oracle independently of generated
  daily-price fixtures. A flat gross-entitlement fixture has zero volatility;
  the risk consumer must reproduce it even when original vendor rows fluctuate.
- Mobile/desktop browser cases distinguish retained vendor disputes from a
  verified calculation basis and preserve the source-inspection link.
- Local live acquisition observed all 1,247 quotes corroborated, 23 adjudicated
  raw closes, 54 explained original return differences, 22 cash events, no
  missing reference sessions and no unexplained issue. This is one issuer and
  one observed window, not a broad provider-accuracy claim.

Deploy the compatible Risk Studio bundle before enabling the worker flag. Merge
only after CI passes. Verify worker startup data checks and a stateless synthetic
PETR4 risk run; refresh the account dataset only after those pass. Retain the
previous risk bundle for recovery. Rollback means disabling the producer flag
and restoring compatible code; it does not erase prior immutable snapshots.
If a data error is discovered, quarantine/recompute affected outputs separately.

`BRAZIL_HISTORY_RISK_CANARY=true` runs one stateless one-share public PETR4
calculation at startup, verifies exact snapshot lineage and the consumer basis,
and writes no user portfolio. `BRAZIL_HISTORY_REPAIR_EXISTING=true` queues only
existing quarantined legacy PETR4 jobs for the current UTC day, once, preserving
the three-attempt cap, owner binding, leases and immutable snapshots. Enable this
repair only after the compatible consumer is live; disable the one-shot flags
after observing success. The ongoing normalization flag remains enabled.

After the stateless risk consumer verifies the exact hash, the same acquired
payload can also be saved for current-day legacy quarantined jobs, including
ones whose provider-attempt budget is exhausted. This maintenance step performs
no new acquisition and never resets attempts. It locks eligible completed or
failed jobs, joins prior snapshots by owner, skips queued/running work, inserts
an immutable version and updates the job's pointer. Original snapshots remain
intact. A subsequent pass is idempotent; another account's snapshot cannot serve
as the prior evidence for a repair.

## Residual risks

| Boundary | Evidence / risk | Control | Residual |
|---|---|---|---|
| Public relay | Missing and duplicate rows; HTML can change | Exact identity/shape, bounds, duplicate receipts, original-feed fallback only on agreement | No service SLA; failure stops refresh |
| Cash events | Gross/net and revised monetary income differ | Versioned gross convention, source-factor checks, exact issuer exceptions | New unmatched event requires review |
| Source integrity | Hash proves bytes, not truthful pricing | Cross-source raw quote checks, issuer cash evidence, retained originals | Upstream independence not certified |
| Risk handoff | Producer/consumer could use different rows | Shared deterministic assessor, strict gate, consumer regression and bundle readback | All affected consumers must adopt the release |
