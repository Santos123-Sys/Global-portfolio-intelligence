# Private Python analysis and broker bridge

Deploy as a **private** Railway service using `railway.filings-python.json` from the repository root. The dashboard must reference its private URL in `FILINGS_API_URL` and share the same random `FILINGS_INTERNAL_TOKEN` (at least 32 characters). Set `OPENAI_API_KEY` on this service; optionally set `FILINGS_EXTRACTION_MODEL` to a PDF-capable model with structured output support. Do not add a public Railway domain.

The authenticated dashboard accepts PDFs up to 5 MB from an approved Swiss/CHF candidate, verifies their static structure, and forwards them to this service. The model proposes only sourced facts with a page and excerpt; Python/pandas checks annual duration, unit, currency and numerical bounds, and calculates draft ratios. Neither the model nor Python approves a fact. The dashboard retains the PDF and draft for owner review. Selected facts alone are inserted atomically into market observations, and the original PDF remains available through an authenticated route. At most ten PDF drafts are retained per candidate.

The existing portfolio report is the mandatory on-screen output (PR #77); its optional PDF is a separate download.

## Interactive Brokers portfolio analytics

The same private service can read an Interactive Brokers account through a reachable TWS or IB Gateway process. It stores account and long-equity snapshots in the dashboard, calculates cost basis, unrealized return and a carefully labeled annualized return when a recent matching fill is available, and supports guarded order previews. The adapter connects with `readonly=True` and contains no order-placement method. Previews are persisted for audit and are never submitted.

Install the service requirements, then configure the `IBKR_*` variables documented in `.env.example`. Leave `IBKR_ENABLED=false` until the gateway connection has been tested in a paper account. Full account identifiers remain in the private service environment; only the final four characters are sent to the dashboard.

Execution history returned by TWS or IB Gateway is limited. The displayed entry date is therefore **first detected fill**, not a guaranteed original purchase date. The UI preserves this limitation alongside each snapshot.

Local deterministic tests: `python3 -m unittest services.filings_python.test_analysis services.filings_python.test_ibkr_portfolio`. Live extraction and IBKR connectivity require their service credentials; deterministic mapping and guardrail tests do not.
