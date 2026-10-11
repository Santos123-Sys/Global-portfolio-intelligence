# Company corpus delivery

Implements the remaining document workflow after PR 147. Baseline: main
7492d9b had no durable document library, no full-text narrative retrieval, no
source-acquisition workflow and no GPI research deck. FilingLens d5c500a already
had PDF extraction and financial-analysis PowerPoint export; those are reused.

## Workflow

GPI company/year import or official-source acquisition → FilingLens full-text
extraction → owner-scoped GPI PostgreSQL library → exact-span lexical retrieval →
bounded research manager → reviewed findings and cited PPTX. A ten-minute,
single-use handoff sends a selected year's documents into FilingLens's existing
financial-analysis confirmation screen. No financial model is recreated in GPI.

## Storage and authority

Migration 003 is additive and idempotent. Raw imported/downloaded files, a
versioned text derivative, source URL, hashes, form, issuer and year are retained
per authenticated owner. Paths are virtual company/year/form/file folders; users
can import a directory and download individual originals. These are not OS paths
supplied to a shell. CVM datasets are company-filtered CSV derivatives, explicitly
labeled with the source archive hash, headers and all matching versions. The
dataset year is a delivery year, not an inferred financial reporting period.

Uploads are user assertions, not regulator-verified identities. No public corpus
or cross-owner cache exists. Deletion removes original/text records and derived
saved research snapshots, revokes handoffs, and fences in-flight report saves.
External copies already downloaded cannot be revoked.

Limits: 8 MB per file; 2 million extracted characters; 1,000 PDF pages; 120 documents
and 160 MB original+text per owner; 12 MB text per retrieval window. Narrow the year
range when a window exceeds the bound. FilingLens now attempts bounded OCR on
image-only PDFs up to 30 pages; failures stay visible rather than silently
manufacturing text. Mixed text/image PDFs still require manual coverage review.

## Retrieval choice and evaluation

Stable 2,400-character spans overlap by 240 characters, prefer newline boundaries,
and retain the final span. A TF/IDF lexical scorer normalizes accents for matching
without changing quoted text. Issuer/year/owner filtering precedes scoring.
Queries use at most 32 unique terms and return at most ten document chunks to the
manager. Numerical authority remains structured FilingLens evidence. This is
retrieval-augmented generation, not a claim of embedding-based semantic search.

No vector service is justified by the current evidence. The regression test
retrieves a disclosure after character 320,000 (unavailable to the old bounded
excerpt input); a separate real Apple issuer-statement fixture preserves the
State Aid disclosure and its unaudited issuer provenance. Synthetic tests cover
wrong issuer/year, Portuguese accents, exact span resolution and absent answers.
These are coverage checks, not a comprehensive Recall@k or semantic-support
benchmark. No production p95 or model quality percentage is claimed.

## Automatic acquisition

GPI requests acquisition using only the authenticated workspace's CIK/CNPJ.
FilingLens delegates official SEC submissions/archive or CVM FRE/ITR/DFP/IPE
downloads to the existing Python data service. No user/model URL fetch tool is
introduced. Exact hosts, no redirects, byte/time/ZIP expansion bounds and a
quarter-second request interval limit the acquisition surface. SEC requires a
configured contact User-Agent. Access denials are reported without bypassing them.
For Apple FY2025 only, the known public issuer statement is an explicitly separate
fallback, never SEC verification. Other missing disclosures can be imported.

Each run returns at most six documents and a bounded response. CVM IPE links can
retrieve up to two official RAD documents within that budget. The worker's lease
is ten minutes to cover bounded acquisition/extraction plus the existing three-call
research budget; expired paid work still is not automatically replayed.

Official-source availability does not guarantee completeness: PDF releases may be
unavailable, issuer sites differ, and FRE/ITR data archives are not complete prose
filings. Missing coverage stays visible. Repeat acquisition or import exact files.

## Slides and upstream reuse

The existing FilingLens python-pptx service now renders saved GPI research with
typed input, exact citation validation, pagination, full source quotes/locators,
human-review labels, and PowerPoint package reopening. No new model calls are
needed to export. The requested [ppt-agent](https://github.com/tobias-bettinger/ppt-agent)
was inspected: its typed-plan/deterministic-builder pattern is reused through
original code; its repository does not expose a license granting code reuse, so
its code is not vendored. Visual QA is distinct from package validation.

## Rollout and rollback

Dedicated FILINGLENS_CORPUS_TOKEN is shared only by GPI server/worker, FilingLens
and its private data service. FILINGLENS_API_URL and GPI_API_URL are fixed HTTPS
origins. The browser never receives the service token. Existing pre-deploy
migration commands apply 003. Enable FILINGLENS_CORPUS_ENABLED and both research
flags after validation; reuse the worker's existing OpenAI credentials/model.
Rollback flags disable acquisition/model use; keep additive tables so files are
not lost. Do not drop storage as part of rollback.

Confidence: 4/5 for the tested bounded implementation. Remaining uncertainty is
live SEC/CVM availability across issuers, scanned documents, semantic paraphrases,
and model interpretation quality. Human review remains required.
