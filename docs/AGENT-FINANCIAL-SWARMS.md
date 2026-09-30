# Financial agent swarms: implementation and deployment

The requested Phase 1–3 functionality runs within the original four layers:

| Layer | Implementation |
|---|---|
| L1 agents | Research Director, eight DCF roles, five financial specialists, Bull/Bear/Judge |
| L2 algorithms | GPT-6 Sol authoring and a separate source-verification pass; structured JSON prompts |
| L3 operations | Unified JSON Tool Registry, persisted runs, bounded QA retries, worker claims and review APIs |
| L4 foundation | Existing PostgreSQL facts, primary filings, Document Intelligence, comparable research, dated capital inputs and deterministic financial calculations |

`reasoningChain` is the public evidence/calculation summary, not private model deliberation. Every output also has status, citations, confidence (0–100) and limitations. Accepted `aiAnalyses` records retain the existing confidence scale (0–1).

## Requested additions

| Previous gap | Behavior now implemented |
|---|---|
| FCFF-only forecast | Linked income, aggregate balance-sheet and cash-flow forecasts, annual reconciliation checks, retained earnings, working-capital/capex schedules, explicit dividends and debt draws |
| Manual WACC only | CAPM from dated currency-matched observations or a canonical source feed; explicit sourced overrides remain available |
| Unavailable estimates | Existing comparable-research adapter plus dated provider estimate observations; public snippet forecasts remain marked for review and never impersonate analyst consensus |
| Unavailable peers | Existing owner-scoped reviewed comparable valuations; same-currency, current records feed the swarm and exit valuation |
| Missing valuation analytics | Perpetuity and median peer exit multiples, 49 sensitivity cells, driver tornado data, seeded Monte Carlo histogram/percentiles, probability-weighted scenarios |
| Minimal technical indicators | Wilder RSI(14), EMA MACD(12/26/9), Bollinger(20/2), moving averages, support/resistance and volume statistics when actual volume exists |
| No independent QA/retries | Exact source-quote checks, uncited-claim threshold, range checks, independently repeated valuation arithmetic, statement reconciliation and separate model source verification; three bounded attempts with JSON feedback |
| Request-owned execution | Railway worker polls the shared dashboard database, claims sessions atomically, renews leases, fences stale owners, preserves evidence snapshots and resumes completed agents |
| Reports disconnected from accepted history | Explicit human review creates an idempotent, thesis-linked analysis version, sets `supersedesId` and preserves prior records |

## Financial assumptions and evidence

The projection is a reconciled aggregate model, not a claim of line-by-line issuer guidance. Opening net operating assets and other liabilities are disclosed aggregates. Forecasts retain earnings, use opening-debt interest, and draw debt to maintain modeled minimum cash. Dividends, margins, growth, capex, working capital and financing policies are editable. Acquisitions, FX changes, buybacks and loss carryforwards are not modeled.

Automatic growth prioritizes reviewed assumptions, dated provider NTM revenue, then historical revenue CAGR. Other drivers use coherent filing ratios unless overridden. Missing opening balances, debt cost, terminal growth or capital premiums remain explicit missing inputs. Financial institutions/REITs are blocked from generic FCFF valuation pending method review.

CAPM never substitutes Selic for a risk-free government yield or invents an ERP/country premium. Currency-matched market inputs must be dated within 180 days; capitalization used for debt weights must be recent. `FINANCE_CAPITAL_DATA_URL` optionally integrates an existing canonical HTTPS data source. It receives `ticker` and `currency` query parameters, optionally uses `FINANCE_CAPITAL_DATA_API_KEY` as a bearer token, and must return:

```json
{
  "riskFreeRate": 0.04,
  "beta": 1.2,
  "equityRiskPremium": 0.05,
  "countryRiskPremium": 0.02,
  "costOfDebt": 0.08,
  "taxRate": 0.25,
  "debtWeight": 0.2,
  "currency": "BRL",
  "asOf": "2026-09-30",
  "sources": ["https://your-verified-source.example/rates"]
}
```

These figures illustrate the contract; they are not production defaults or current market estimates. Without a configured feed, the adapter uses retained observations with metric names `risk_free_rate`, `beta`, `equity_risk_premium`, `country_risk_premium`, `cost_of_debt`, `terminal_growth_rate`. Source dates and coverage are necessary; implementing an adapter does not create vendor coverage or entitlement.

Exit valuation requires at least six verified positive peer EV/EBITDA ratios. Monte Carlo requires explicitly reviewed widths and probabilities. Its independent triangular distributions describe a modeling policy, not calibrated market probabilities. Invalid simulations are counted; more than 20% invalid samples reject the run. Missing volume/history stays null.

News continues through existing NewsAdapter-ingested documents. No scraper is rebuilt. Exact citations, matching quoted evidence and independent model review reduce unsupported claims; model verification does not guarantee truth.

## Railway rollout

1. Apply migrations 0019, 0020 and 0021 through the existing dashboard Drizzle migration workflow. The latter migrations add session leases/evidence snapshots and optional price volume; they do not replace existing tables.
2. Build the worker with `npm run build:agentic`. This bundles the shared four-layer financial runtime into the existing agentic worker, rather than introducing another service.
3. On the **agentic worker**, set `FINANCE_DATABASE_URL` to the **dashboard PostgreSQL database** URL. Keep `AGENTIC_DATABASE_URL` pointing to the existing agentic-job store. The databases may differ.
4. Keep `OPENAI_API_KEY` and `OPENAI_MODEL=gpt-6-sol` on the worker. Configure existing provider/search keys there if live comparable research is needed. Shared modules that invoke existing provider configuration need `SESSION_SECRET`, and production `PUBLIC_APP_URL`, as required by existing environment validation. Configure Gemini/vector retrieval keys if supplemental RAG verification is enabled.
5. Optionally configure the canonical capital feed variables above. These are server-only variables, never `NEXT_PUBLIC_*`.
6. The dashboard queues `/api/agents/analyze` requests; it no longer uses `after()` for execution. The authenticated cron drain remains an operational fallback with identical atomic claims. Running sessions receive a two-minute lease, renewed every 30 seconds. Expired sessions resume up to three worker claims, then fail explicitly.
7. Open `/security/[ticker]?tab=agent-analysis`, choose the portfolio/thesis when there are multiple scopes, review optional financial/simulation policies, and run the analysis.
8. Inspect individual outputs, statement checks, sensitivity charts, distributions and limitations. Only completed, confidence >=60, judge-reviewed reports linked to an active owned thesis can be accepted. Excluded/superseded theses and read-only viewers cannot publish reports. Acceptance creates an append-only version rather than destructively overwriting history.

## Verification boundary

Unit/regression tests cover statement identities, financing draws, terminal calculations, CAPM, simulation determinism/probabilities, technical indicators, feed freshness/currency rejection, citation checks, QA feedback/retry bounds and stale-lease fences. CI also builds the worker bundle. Live vendor entitlements, real model/source-verification behavior and migrated Railway execution require deployment validation with actual configured services.

The original request scoped implementation to Phases 1–3. Three-tier Redis memory, CVRF belief learning, automatic earnings/price triggers and websocket events belong to later roadmap phases; this change does not claim those phases are delivered.
