# TDMRA rollout and Railway variables

## Workflow

An approved Discovery candidate now moves to `market_research_preparing` and
starts a durable `market_brief` job. The Research Inbox polls and displays the
completed brief with its evidence register and information gaps. A user must
approve the brief before the dashboard starts the existing financial-analysis
run. That run receives the brief and source URLs as additional grounded
research evidence. DCF, comparable-company valuation, risk calculations and
portfolio weights stay in their existing deterministic workflow.

## Railway services

Set or verify these variables on **agentic-worker**:

| Variable | Value / purpose | Required when |
|---|---|---|
| `OPENAI_MODEL` | `gpt-6-sol` | Always; this is the production model baseline. |
| `OPENAI_API_KEY` | Existing OpenAI secret | Always. |
| `OPENAI_REASONING_EFFORT_MARKET_BRIEF` | `high` | Optional; defaults to the configured global effort. |
| `MARITACA_API_KEY` | Maritaca API secret | Brazilian Data Ocean research. Without it, the brief records a source gap. |
| `MARITACA_DATA_MODEL` | `sabia-4-thinking` | Optional; default shown. The Data Ocean integrated tool is supported by this model. |
| `BRAPI_API_KEY` | BrAPI API token | B3 indicator retrieval. Endpoint availability depends on the BrAPI subscription. |
| `SEC_USER_AGENT` | `Portfolio Intelligence contact@yourdomain.example` | SEC EDGAR issuer facts. Must identify the application operator and include a contact email. |

`SEC_USER_AGENT` is also used by the dashboard's existing CompanyFacts route.
Set the same identifying value on the **dashboard** Railway service if it is
not already present there. Keep API secrets in Railway's encrypted Variables,
never in the browser or a committed `.env` file. Railway restarts/redeploys a
service after a variable changes; configure the worker and dashboard services
separately because they do not share process environments.

The system treats these providers as independent source adapters, not as a
unified licensed quote feed:

- Maritaca Data Ocean is enabled through the Sabiá API's `data_ocean` tool; the
  TDMRA synthesis model remains GPT-6 Sol.
- BrAPI is requested for current B3 financial indicators only. A 403/429 or an
  unavailable plan becomes an explicit gap in the brief.
- SEC EDGAR supplies US company submissions/XBRL filing evidence, not exchange
  prices. Quote/history requests remain with the configured market-data
  provider.
- If Maritaca does not return a verifiable CVM-domain URL, the brief says CVM
  filings were not verified. Existing direct CVM DFP ingestion remains the
  filing source used later by financial analysis.

## Database rollout

Deploy the application migration (`drizzle/0016_tdmra_market_brief.sql`) and
agentic migration (`services/agentic/migrations/003_market_brief.sql`) before
starting new TDMRA jobs. The dashboard migration adds candidate-level dispatch
and review state. The worker migration adds the new queue kind.

## Validation after setting variables

1. Confirm the agentic worker starts and logs `model gpt-6-sol`.
2. Approve one Brazilian candidate and verify that the TDMRA run records
   Maritaca/BrAPI availability or a clear provider gap.
3. Confirm the brief includes source URLs, citations, and missing-data notes.
   Every TAM/SAM/SOM item must cite at least two distinct source domains.
4. Confirm financial analysis does not start until a human clicks **Approve
   market brief and start financial analysis**.
5. Approve one US candidate and confirm SEC source mapping and XBRL retrieval;
   compare filings to the filing period, not current share price.
