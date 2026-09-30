# Agentic Financial Analysis: Phases 1–3

## Four layers

- L1 `src/lib/agent-finance/l1`: Research Director, DCF swarm, parallel analysis specialists, Bull/Bear/Judge.
- L2 `l2`: GPT-6 Sol model router and structured role prompts. `reasoningChain` is a public evidence/calculation summary, not private model deliberation.
- L3 `l3`: JSON Tool Registry, schema validation, persistence and execution engine.
- L4 `l4`: existing financial observations, prices and Document Intelligence stores. News comes from existing NewsAdapter-ingested documents; no scraper is rebuilt.

Every validated agent output has status, data, confidence 0–100, citations, limitations and a nonempty audit summary. Unknown references are rejected; no-source outputs have zero confidence. Agents cannot execute arbitrary Python. Deterministic calculations use the existing FCFF/DCF library through registered tools.

## Deployment

1. Apply migration `0019_agent_financial_swarms` through the existing migration workflow (after 0018). The generated SQL contains only the five new agent tables, not duplicate Document Intelligence/IBKR tables.
2. The current executor runs in the Next.js service using `after()`, with persistent queued sessions and atomic claims. Configure server-only `OPENAI_API_KEY` and `OPENAI_MODEL=gpt-6-sol` on this service. Do not use `NEXT_PUBLIC_` variables. Keys configured only on the separate agentic worker do not automatically reach the Next.js service.
3. Schedule authenticated `POST /api/cron/agent-finance` with the existing `CRON_SECRET` to drain abandoned queued sessions and mark stale running sessions failed. A ten-minute stale-session timeout is explicit; interrupted work is not silently reported complete. This endpoint is not yet connected to the separate worker's claim loop.
4. Open `/security/[ticker]?tab=agent-analysis` for a held or researched security. Viewers may inspect their reports but cannot start paid analyses or submit feedback.
5. DCF inputs must include a coherent primary fiscal filing and reviewed growth/WACC/terminal growth. Missing fields are blocked, never synthesized. No position/order or accepted investment recommendation is written automatically.

## Implemented

- Five Drizzle/PostgreSQL tables from the framework, queue indexes and owner-scoped APIs.
- Unified typed JSON registry, mock fixtures and persistent individual agent audit logs.
- DCF roles, FCFF derivation, existing deterministic valuation engine, 49 sensitivity cells and three illustrative growth scenarios.
- Five analysis specialists in parallel, opposing Bull/Bear arguments, Judge synthesis and persisted debate.
- Session status, reasoning, history and feedback APIs.
- Dashboard tab and PDF-described scanner/bar-wave/balance loading screens in `/public/loading`, with iframe sandboxing, reduced-motion support, ARIA status and fallback text. The attachment is a specification PDF, not source HTML; these implementations reproduce its described visuals.

## Explicit remaining scope / limitations

This is a working first implementation, **not complete blueprint parity**:

- Projection Builder currently derives and forecasts FCFF, not a reconciled three-statement model. WACC uses reviewed override; the CAPM tool exists but automatic sourcing of rates/beta/premiums is not wired.
- No supported canonical adapter yet for analyst estimates or peer data. These tools return explicit unavailable responses. Source evidence currently comes from persisted provider/Document Intelligence data, not new live provider retrieval.
- Exit-multiple valuation, tornado charts, reviewed Monte Carlo probability distributions, probability-weighted scenarios and independent numerical/source QA retry cycles remain unimplemented.
- Technical statistics currently cover moving averages and observed support/resistance, not RSI/MACD/Bollinger/volume modeling.
- Debate outputs are structured evidence summaries, not a guarantee of investment accuracy. Model citations are allowlisted, but independent claim-to-sentence verification remains future work.
- Combined execution follows the framework's DCF-then-Analysis table. The PDF describes the opposite order; UI shows actual persisted phase rather than fabricated progress.
- The final result remains in agent sessions until human review; it does not overwrite `aiAnalyses`, whose thesis-linked acceptance contract must be preserved.
- Three-tier Redis memory, CVRF belief updating, automatic earnings/price/weekly triggers, websocket events and cross-run learning are Phases 4–5 and are not enabled here.

## Verification

`tests/agent-finance.test.ts` checks JSON isolation, output validation, execution ordering, blocked missing inputs, FCFF/net-debt calculations, sensitivity shape and absent-ratio safeguards. Real provider entitlements, live model responses, migrated production database and deployment worker behavior require separate runtime verification.
