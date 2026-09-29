# Document intelligence operations

This implementation follows the phased document-intelligence blueprint. A company workspace is created for each `(owner_id, security_id)` holding. Discovery downloads primary filings, normalizes and deduplicates them, creates semantic chunks, embeds those chunks with Gemini, and stores 768-dimensional vectors in PostgreSQL with pgvector. Retrieval is always prefiltered by the same tenant and security keys before reranking and grounded answer generation.

## Required services and configuration

PostgreSQL must support the `vector` extension. Deploy migration `0018_document_intelligence.sql` before starting the new application version. Set `GEMINI_API_KEY` and `DOCUMENT_STORAGE_PATH`. Production uses the existing Railway object bucket through `AWS_S3_BUCKET`, `AWS_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION`; when those values are absent, local filesystem storage is used. `SEC_USER_AGENT` must contain a monitored contact email. Set `NEWS_SCRAPER_DB_PATH` only where the existing scraper SQLite output is mounted and readable.

Optional tuning variables are `EMBEDDING_BATCH_SIZE=100`, `CHUNK_TARGET_SIZE=800`, and `MAX_CONCURRENT_DOWNLOADS=5`. All secrets remain server-side and none use a `NEXT_PUBLIC_` prefix.

## Processing and isolation

Adding a position provisions a company workspace and queues `full_ingestion` inside the position transaction. Migration 0018 performs the equivalent backfill for current holdings. Manual uploads accept PDF, HTML, XBRL/XML, and text up to 50 MB. Document, chunk, and embedding records commit atomically after parsing, storage, and embedding complete. Raw vectors are never returned by an API.

Every workspace API verifies that the selected account owns a portfolio containing the workspace security. Document and vector queries also filter `owner_id` and `security_id`. RAG answers reject missing or invalid citation markers. Superseded filings remain retained for lineage but are excluded from retrieval.

The NewsAdapter reads rows produced by the existing scraper from its SQLite database and maps them to `NEWS_ARTICLE` documents. It contains no fetching or scraping logic.

## Schedules

Call `GET /api/cron/document-intelligence?job=<type>` with the existing cron authorization secret. Configure these Railway schedules:

| Job | Schedule (UTC) |
| --- | --- |
| `full_ingestion` | Monthly, day 1 |
| `incremental` | Monday 06:00 |
| `material_disclosure` | Every 4 hours |
| `news_sync` | Daily |
| `retry_failed` | Every 6 hours |
| `index_maintenance` | Sunday 02:00 |

Index maintenance vacuums and analyzes weekly. During the first seven days of each month it also rebuilds the HNSW index. Cron calls use the existing `job_locks` coordination through queued job processing, so overlapping ingestion for one workspace is skipped.

## Monitoring and recovery

Platform administrators can inspect `/admin/document-intelligence`. Each ingestion job retains counts, timestamps, bounded errors, and structured log entries. Document rows move through `pending`, `downloading`, `parsing`, `chunking`, `embedding`, and `indexed`; failures retry through scheduled rediscovery up to the configured document retry boundary, after which they remain visible as permanent failures.

For deployment verification, open an existing holding, follow **Open document intelligence**, run **Refresh sources**, and confirm that a document reaches `indexed`. Ask a question whose answer is present in that filing and confirm the answer includes numbered citations. For news, run the current scraper first, then invoke `news_sync` and confirm `NEWS_ARTICLE` rows appear in the document library.

To roll back, stop document-intelligence cron triggers, deploy the previous application release, and retain the seven new tables and stored objects. They are isolated from portfolio calculations and can safely remain for a forward fix. Drop them only after a backup and only when the retained research, conversations, and citation lineage are no longer required.
