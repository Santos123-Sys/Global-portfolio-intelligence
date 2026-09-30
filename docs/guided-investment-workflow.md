# Guided investment workflow

## Assessment and changes

| Current friction | Implemented behavior | Controls retained |
| --- | --- | --- |
| Manual creation, questionnaire, upload and version history compete on entry | Current approved strategy first; upload is the default entry; alternatives and archive are disclosures | All creation methods, version editing, exclusion and JSON export |
| Completed and approved extraction rows compete for review | Unapproved documents have a separate queue; approved source documents have a separate archive | Source extraction, ambiguities, confidence, dismissal and linked-version warnings |
| Upload and extraction leave the next step unclear | Selected document gets an extraction status; completed extraction focuses the review panel | No automatic approval; failed extraction retry; persisted queue |
| Detailed policy forms obscure objective, destination and currency | Essential fields first; classified rules and eligibility are grouped; manual creation opens them | Same criteria schema, search preview, contradiction checks and acknowledgment gates |
| A fresh manual draft silently assumes Switzerland | New drafts require an explicit market and currency | Existing approved/extracted mandates keep their values |
| Discovery repeats every decision form and analysis | Compact company summaries with one expanded review; company, portfolio and decision filters | Decision journal validation, evidence gaps, conflict counts, source URLs and rejected-history rules |
| Users cannot tell whether discovery is loading or empty | Explicit loading state and next action; another search is disabled during an active discovery run | Existing server readiness and durable dispatch |
| Research shows superseded versions alongside current conclusions | Current versions by default; explicit history checkbox; newest first | Version history, changed conclusions and thesis violations |
| Company actions obscure DCF and navigate to another workflow | Descriptive section labels; DCF & peers; company analysis opens this company's analysis tab; exports grouped | Existing financials, valuation, risk, reports and agent execution |
| Phase numbering skips analysis | Four consistent steps in primary navigation and a shared responsive route map | Positions, allocation, risk and investment control |

## Engineering boundaries

Reuse PostgreSQL, Drizzle, Next.js routes, existing CSS variables and glass panels. No schema changes or new UI dependencies. The workflow map identifies the current route, not investment completion. Financial computation and approval policies are unchanged. Valuation tools are dynamically imported when opened.

The Analysis inbox only hides rows explicitly superseded by another returned analysis. Independent mandates are preserved. The existing API returns up to 50 recent rows; this change does not introduce an unlimited history archive or change API authorization.

## Validation

Existing thesis review and structured lifecycle browser tests exercise contradictions, draft recovery, currency, stale-version conflicts, failed uploads and confirmation. Existing discovery browser tests exercise candidate decisions, embedded reports, FCFF and DCF. Additional tests cover current-thesis entry on phone/desktop, upload-to-review focus without approval, exclusive candidate expansion and filters, analysis history disclosure and company analysis routing. All browser API fixtures are deterministic; production provider latency and Railway behavior are not measured by these checks.
