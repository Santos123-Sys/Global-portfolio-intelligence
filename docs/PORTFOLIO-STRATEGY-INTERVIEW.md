# Portfolio Creator

## User flow

Portfolio Creator is the Gemini-backed, saved conversational workflow on Portfolio Strategy:

Investor profiling → profile assessment → portfolio constraints → strategy proposal → PDF and human review → portfolio creation and Discovery.

The investor answers one scored question at a time. No strategy-generation model call is permitted until all eleven answers have been scored and the investor confirms the result and strategy scope. Answer choices can be selected or entered as letters; ambiguous prose is never silently scored by a model.

The source framework is Vanguard Investor Questionnaire (2022), questions pp. 4–5, scores p. 6 and allocation guide p. 7. The original answer order, point allocations and nine score bands are encoded in `src/lib/investor-profile.ts`. The total is 7–75. Additional liquidity, income, loss-tolerance and experience warnings are application checks; they do not alter the source score. The questionnaire is a general guide using U.S. stock/bond assumptions, not comprehensive advice or a Brazilian suitability certification. Reassess when circumstances change.

| Score | Suggested stocks / bonds | Source category |
| --- | --- | --- |
| 7–22 | 0 / 100 | Income |
| 23–28 | 20 / 80 | Income |
| 29–35 | 30 / 70 | Income |
| 36–41 | 40 / 60 | Balanced |
| 42–48 | 50 / 50 | Balanced |
| 49–54 | 60 / 40 | Balanced |
| 55–61 | 70 / 30 | Growth |
| 62–68 | 80 / 20 | Growth |
| 69–75 | 100 / 0 | Growth |

The platform researches listed equities. A suggested stock/bond mix is not applied as security weights. The investor must choose an equity sleeve within a broader portfolio or explicitly request a full-equity strategy. An equity sleeve is unavailable when the guide suggests zero stocks. Departing from the guide with a full-equity strategy requires an explanation and acknowledgment. Bond selection and whole-household suitability assessment remain outside this workflow.

## State and recovery

`portfolio_creator_sessions` stores the interview, answers, confirmed assessment, draft and generation status in PostgreSQL under the existing authenticated workspace-owner scope. Revisions fence every write and model completion. Reload restores the current question or proposal. Model errors retain the saved user turn for explicit retry. Stop invalidates the outstanding turn so a late response cannot overwrite current state; it does not guarantee cancellation of provider-side computation. A stalled request exposes Stop rather than inventing completion or automatically approving anything.

The canonical routes are `/api/thesis/portfolio-creator` and `/api/thesis/portfolio-creator/draft`. Historical `strategy-chat` routes delegate to them. The legacy generation endpoint also requires a confirmed saved profile. Final PDF generation reads the server-saved draft and profile, not a client-supplied replacement. Profile scores are recomputed from saved answers at each trust boundary.

The PDF enters the existing completed extraction queue, preserving the criteria editor, version checks, approval transaction, audit and Discovery transition. The profile snapshot is retained in the extraction and approved thesis version. Server-owned profile constraints are restored during approval even if removed in the editor. No draft becomes canonical before explicit approval. Historical pending assistant drafts without a profile must be regenerated; previously approved theses and user-imported source documents remain valid.

## Gemini configuration and data handling

The dashboard server uses the existing `GEMINI_API_KEY` and `gemini-3.8-flash`. No new Railway model variables are required. The API key stays server-side. Model turns receive the confirmed profile, conversation and working draft. Questionnaire scoring and PDF rendering are deterministic and do not need a model. Returned provider thought parts are excluded from user-facing responses.

Answers, confirmed scope, proposal and up to 24 conversation messages are now persisted, unlike the former browser-only conversation. They contain personal financial preferences; apply the platform's existing database access and backup controls. Restarting clears the current interview and unapproved proposal, while approved strategy snapshots remain in the existing version history. Account owners and their authorized workspace members use the same existing ownership model; this feature does not introduce per-member private interviews.

## PDF and rollout

The short equity-research-inspired mandate includes executive summary, profile and scoring record, strategy scope, portfolio destinations, selection policy, construction constraints, risks, monitoring, governance and limitations. It asserts no invented issuer facts, performance, forecasts or valuations. Approved-version PDFs regenerate from the persisted strategy and profile.

Before deployment, apply `drizzle/0025_busy_gideon.sql` with the existing dashboard `npm run db:migrate`, then redeploy the dashboard. Redeploy the agentic service with the same revision for release consistency. This migration is separate from the agentic service's own database migrations and does not require a new database URL. Without it, Portfolio Creator returns a visible loading error rather than bypassing profiling.

Automated Discovery coverage remains B3 (BVMF) and SIX (XSWX). Unsupported authored markets are disclosed by the existing review flow. Provider credentials, entitlements and live Railway/database behavior require deployment verification.
