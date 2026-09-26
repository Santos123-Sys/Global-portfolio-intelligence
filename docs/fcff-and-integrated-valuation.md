# FCFF and integrated valuation review

Research date: 2026-09-26. This change follows merged PR #88.

## Method selection

CFA Institute's [Free Cash Flow Valuation](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/free-cash-flow-valuation) describes FCFF as a calculated quantity and gives EBIT and CFO derivations. Damodaran's [Chapter 14 derivations](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/CFTheory/deriv/ch14der.html) provides the operating-profit, reinvestment, and working-capital relationship.

| Route | Calculation | Evidence needed |
| --- | --- | --- |
| Explicit FCFF | Retain the verified FCFF observation | Review issuer definition |
| EBIT | EBIT × (1 − tax rate) + D&A − capex − non-cash working-capital investment | Coherent financial filing; positive WC means investment |
| CFO | CFO + interest expense × (1 − tax rate) − capex | Confirm interest is included in CFO; do not deduct working capital again |

Automatic selection prefers explicit FCFF, then complete EBIT inputs, then CFO. Missing values are never zero-filled. A reported effective tax rate is available only with positive pretax income and a ratio between zero and one; it is explicitly identified as a proxy. A reviewed tax override and working-capital investment can be supplied with a dated source and rationale. The review is bound to the filing period and currency and stored with the original input snapshot. A changed fiscal period or currency requires a new review; the server always recomputes from the currently selected filing.

The SEC and inline-XBRL parsers retain available D&A, interest, tax, and pretax-income tags. Generic CFO-minus-capex remains generic FCF. Incomplete filings remain incomplete. No inference that all IFRS issuers classify interest in operating cash flow is made.

## Workflow and product research

[AlphaSpread](https://kb.alphaspread.com/hc/en-us/articles/18213235146513-What-is-Intrinsic-Value) presents DCF and relative valuation together and describes averaging them. Adopt the joint presentation, but keep independent estimates: the project has heterogeneous evidence and no validated weighting policy.

[Finbox's published model reliability approach](https://finbox.com/blog/introducing-finbox-uncertainty-levels-to-fair-value-estimates/) excludes models that fail required checks and exposes uncertainty. Adopt explicit readiness checks, scenario ranges, sensitivity, and missing-method visibility. Do not infer confidence from the number of models alone.

The embedded valuation workspace now links DCF, peers, and a comparison section. Users can supply nine reviewed scenario rates instead of waiting indefinitely for unavailable scenario-driver records. Calculation remains deterministic; WACC, growth, and terminal growth are never invented. The existing five-year horizon is retained. WACC must exceed terminal growth and the computed cases must be ordered.

The comparison table shows independent DCF cases and peer median estimates, currencies, and target financial periods. Base-case sensitivity and terminal-value concentration are visible. Peer inputs now require currency, financial period, market-data date, explicit net debt, and source. Different peer currencies are valid for dimensionless ratios only when all numerator and denominator inputs within each peer use the same currency and units. No FX conversion occurs.

Target comparable inputs now come from one coherent filing, with original target references retained. DCF reloads only DCF scenarios, preventing a newer comparable calculation from hiding the last DCF. Reports retain FCFF computation and reviewed assumptions in an appendix.

## Limits

- This removes the artificial requirement for a pre-labelled FCFF figure; it cannot create missing accounting evidence or a defensible cost of capital.
- Negative/zero FCFF, unsuitable sectors such as financial institutions, and incomplete equity bridges still need another model or better evidence.
- No automatic normalization of acquisitions, leases, capitalized R&D, SBC, nonrecurring items, marginal tax transitions, or reinvestment/ROIC forecasts is attempted. Review capex scope, including intangible investment, before relying on the output.
- Existing debt tags may represent long-term debt rather than all financing claims. The simple debt-minus-cash bridge is not a full adjustment for minority interests, preferred claims, pensions, or non-operating assets. Share classes and dilution also require review.
- Peer dates and currency declarations are retained, not independently verified; mismatched LTM/annual definitions and old market data still require judgment. Historical saved peers lacking dates display unknown.
- Browser verification uses mocked API data; unit tests exercise server evidence gates. Live provider coverage and production database behavior are not certified by these tests.

## Validation

Formula tests cover both derivations, WC investment/releases, missing inputs, tax anomalies, capex signs, and overflow. API tests cover derived FCFF without pre-labelled FCFF, retained review provenance, stale currency/period rejection, and unconfirmed/invalid rates. Mobile browser coverage exercises discovery → analysis → reviewed FCFF → saved DCF → sensitivity and comparison. Existing deterministic DCF and PDF tests remain in the suite.
