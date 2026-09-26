# Post-discovery analysis, valuation and reporting review

## Research basis

- Aswath Damodaran, NYU Stern, Approaches to Valuation: https://pages.stern.nyu.edu/adamodar/New_Home_Page/lectures/approach.html
  Match the cash-flow definition to the valuation method and discount rate. Cash flow to the firm and cash flow to equity are not interchangeable.
- CFA Institute Standard V(B), Communication with Clients and Prospective Clients: https://www.cfainstitute.org/standards/professionals/code-ethics-standards/standards-of-practice-v-b
  Distinguish facts from opinions and disclose significant analytical limitations. These principles guide interface design; software gates do not establish professional compliance.

## Scope and retained architecture

The post-discovery phase includes company research and price risk, approved primary-source financial inputs, deterministic valuation, and an embedded report with optional PDF. It is the final research deliverable, not the end of the investment lifecycle: monitoring thesis breakers and refreshing evidence continue afterward.

Keep source-grounded research, separate limited-data analysis, deterministic DCF/comparables/risk engines, explicit assumptions, human review, same-filing financial snapshots and authenticated report access. The embedded financial report and optional PDF continue to consume one report model. No extra agents or automatic trades are introduced.

## Findings and implemented changes

### Cash-flow basis and method selection

The IR/SEC importers derive generic free_cash_flow as operating cash flow minus absolute capital expenditure. That does not establish unlevered FCFF, particularly where operating cash flow includes interest. Automatic FCFF valuation now requires the distinct free_cash_flow_to_firm metric from primary-source evidence. No implicit financing or tax adjustment is performed. Existing importers do not currently populate this metric: automatic DCF stays blocked until an explicit verified FCFF importer/derivation is implemented. Financial reporting, qualitative research and comparable analysis remain available.

The existing sector-method warning is enforced by the API readiness check: financial institutions and real-estate vehicles cannot bypass the suggested alternative-method review merely by supplying numbers. This is a conservative classification heuristic, not an automatic choice of a bank/insurance/REIT valuation model.

The deterministic engine rejects overflow in calculated valuation outputs. Existing growth/rate bounds, sensitivity analysis, terminal-value concentration warning and scenario ordering remain.

### Input coherence

DCF snapshot selection now rejects impossible/future fiscal dates and inconsistent or invalid duplicate metric values within the selected filing. One fiscal end, source URL and filing label are used; missing/conflicting facts are not filled from older reports. Ambiguous revisions require a distinct coherent filing/revision rather than arbitrary first-row selection.

Saved DCF dataAsOf now denotes the selected financial fiscal date, not the date of the latest unrelated database retrieval. Assumption source references remain retained. A five-year forecast horizon remains an application policy, not a reported fact.

### Comparable valuation logic

Missing target net debt no longer defaults to zero. EV-based implied enterprise value remains visible; equity and per-share values are unavailable until the bridge is supported. P/E can still yield equity value because it does not use that bridge. Non-finite target values and nonpositive supplied share counts are rejected.

The existing peer EV bridge still assumes absent minority interest/preferred stock are zero. Broader accounting-consistent bridge inputs, peer period/currency alignment and explicit treatment of financial firms require a dedicated comparables contract change; this patch does not certify comparability.

### Embedded and PDF output

The report distinguishes partial financial evidence from complete required metric presence. It displays fiscal period and retrieval date separately and distinguishes retained financial evidence/calculations from valuation estimates. Impossible and future fiscal dates are excluded. Growth is withheld when adjacent fiscal ends are outside a 350–380-day interval, with a visible reason. This accommodates common 52/53-week fiscal years but does not prove reporting-period comparability or account for restatements/accounting changes.

The PDF shares these fields and caveats with the embedded report. Accessible heading IDs are candidate-specific. No missing financial value is estimated.

## Deferred / limits

- Explicit FCFF derivation needs supported EBIT, tax, D&A, capital expenditure and working-capital evidence, plus accounting policy review; adding an LLM label would not be sufficient.
- Scenario assumptions need a richer typed provenance and review contract for WACC/currency, dates and scenario sets. Current numeric/source records alone do not prove economic validity.
- Historical stored valuations remain immutable and are not retroactively recalculated or certified by these new gates.
- The generated PDF report is an export at request time, not a cryptographically frozen evidence package. Stronger report/version/source binding remains future work.
- No live-provider accuracy, production database persistence, or investment-performance claim is made by local tests.

## Verification

API tests cover FCFF versus generic FCF, method mismatch despite complete numbers, conflicting filing facts and the fiscal dataAsOf saved on successful valuation. Deterministic tests cover missing-debt bridges, invalid target values, overflow, invalid/future periods and noncomparable growth. Mobile browser verification covers approval through embedded report access and the optional PDF link. A representative PDF is rendered for visual inspection.
