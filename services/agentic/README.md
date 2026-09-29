# Agentic API and Worker

This workspace is the reasoning half of Portfolio Intelligence. It runs as two
private Railway services from the same build:

- `agentic-api`: authenticated run/extraction/status/report HTTP endpoints;
- `agentic-worker`: durable PostgreSQL queue consumer, OpenAI calls, validation,
  PDF generation, bucket upload and dashboard callback delivery.

Both processes use the same `AGENTIC_DATABASE_URL`. This database is separate
from the dashboard database. The only dashboard write boundary is the
authenticated manifest callback.

## Single-model policy

GPT-6 Sol (`OPENAI_MODEL`) is the production analysis and synthesis baseline.
The separate Brazilian evidence-retrieval integration calls Maritaca Sabiá 4
Thinking only when Brazilian research is requested and `MARITACA_API_KEY` is
configured; GPT-6 Sol remains the TDMRA brief writer. BrAPI supplies targeted
financial indicators for B3 tickers; SEC EDGAR supplies US issuer filings and
XBRL facts. SEC EDGAR is not a market-quote feed. All provider outputs enter a
source register and unsupported claims are rejected by the market-brief
contract. There is no model voting layer or automatic model fallback.

## Local commands

```bash
npm run build:agentic
npm run agentic:migrate
npm run agentic:api
npm run agentic:worker
npm run test:agentic
```

The API listens on `0.0.0.0:$PORT`. Every `/v1/**` route requires
`Authorization: Bearer $AGENTIC_SYSTEM_API_KEY`; `/health` is intentionally
unauthenticated for Railway health checks.

## Endpoints

```text
POST /v1/thesis-extractions
GET  /v1/thesis-extractions/{externalExtractionId}
POST /v1/thesis-extractions/{externalExtractionId}/retry

POST /v1/analysis-runs
GET  /v1/analysis-runs/{externalRunId}
POST /v1/analysis-runs/{externalRunId}/retry
GET  /v1/analysis-runs/{externalRunId}/report
POST /v1/market-briefs
GET  /v1/market-briefs/{externalMarketBriefId}
POST /v1/market-briefs/{externalMarketBriefId}/retry
GET  /health
```

Start calls return HTTP 202 after the durable job row exists. The worker claims
jobs with `FOR UPDATE SKIP LOCKED`, renews the lease after each stage and never
returns a successful manifest if any requested security is missing. Callback
delivery uses bounded exponential retry without creating a second run.

## Artifacts

Production requires a private S3-compatible Railway bucket. Configure either
the `AGENTIC_BUCKET_*` variables or Railway's bucket variables (`BUCKET`,
`ENDPOINT`, `REGION`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`). Development and
tests fall back to PostgreSQL `bytea`; production refuses to start without the
bucket.

Reports are real PDFKit documents using bundled Inter fonts. The API reads the
private object and streams it to the dashboard, which in turn proxies it to an
authenticated browser.
