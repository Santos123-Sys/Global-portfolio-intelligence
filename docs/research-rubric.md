# Curated source relationships and research rubric

## Implemented scope

GPI now groups research evidence that shares an HTTPS source reference, corpus document ID or raw-document SHA-256. The grouping is deterministic, transitive and order-independent. It retains every evidence record and its original quote. URL fragments are ignored, query parameters are preserved and sorted, and credentials/non-HTTPS URLs are not used as public-source identifiers. Relative uploaded-document links need a document ID/hash; otherwise the reference stays unresolved.

This is a **dependence warning**, not a count of independent confirmations. Different URLs/documents can repeat the same issuer claim. Source identity does not prove truth, independence, issuer assignment or fiscal comparability. Multiple versions at the same URL are conservatively grouped; versions and original evidence remain separate records. Uploaded metadata remains a user assertion. No new metadata is accepted from a model or an API request.

The research report exposes source-reference groups and their records even when models are disabled. Previously stored reports have no summary field and continue rendering normally. Manager/analyst/critic inputs receive scoped source summaries; analyst/critic summaries include only retrieved records. The source inventory is capped at one hundred records. Existing transport/context/call/deadline caps and human review remain enforced.

## Candidate rubric and rollout

`RESEARCH_RUBRIC_ENABLED=false` by default. The baseline prompts are preserved byte-for-byte. Enabling the flag appends compact rules on thesis/horizon, competing explanations, repeated-source claims, management assertions, confounding, disagreement and observable falsifiers. The candidate prompt version is `equity-evidence-research-2026-10-22-v2`. Rubric blocks are each bounded by a two-thousand-byte regression check; that is not a tokenizer measurement or a performance claim.

Both profiles still use at most three model calls, five allowed evidence tools and six findings. No personas are installed, no framework/service is added, and the rubric grants no tools, calculation, approval, trade or payment authority. FilingLens retains financial/valuation ownership and Portfolio Risk Studio retains portfolio/risk ownership. No production flag is enabled by this patch.

Switching the flag back to false restores the baseline prompt text. Source-relationship summaries remain a deterministic feature. For a complete rollback of that feature, revert this patch; persisted summaries are additive and require no database migration.

Both evaluation profiles receive the same source summaries. Their comparison isolates the appended rubric, not the separate effect of adding source metadata to the prior application.

## Reproducible comparison runner

Run the preflight without credentials or model calls:

```sh
npm run research:evaluate
npm run research:evaluate -- --trials 5
```

The bundled twelve cases are **synthetic English/Portuguese controls**, using fictional `example.test` source URLs. They cover repeated origins, mirrored document bytes, conflicting assertions, source-embedded injection, wrong issuers and wrong years. They are not real SEC/CVM filings, independently adjudicated gold labels or proof of research quality. Expected outcomes and review checks are human-review guides, not automated semantic grading.

The dataset schema also accepts reviewer-supplied document metadata/text. Use canonical issuer IDs and exact source-document/text hashes, fiscal windows, locators, extraction method and retrieval time. Wrong-scope or corrupt document derivatives are excluded by existing corpus retrieval. Financial snapshots are deliberately unavailable in this runner: it evaluates narrative research and never fetches data or invents numerical facts.

A deliberately explicit small live comparison, after configuring credentials in the process environment:

```sh
npm run research:evaluate -- --live --limit 1 --trials 1 \
  --max-model-calls 6 --out evaluation-results/research-pair-001.jsonl
```

`--live` is mandatory for paid calls. The default six-call ceiling refuses the full fixture set unless explicitly increased. The complete dataset and requested trial/limit bounds are validated first. The manifest freezes dataset/case/prompt hashes and records maximum call/completion allowances. Prompt order alternates per case/trial. Model calls use the same configured model and current transport parameters for both profiles; no claim of deterministic generation is made. Production flags are never modified: the script enables its own process flags only after the live checks. A fail-closed run stops the experiment instead of repeatedly calling a failing provider.

Results are appended and synced after each completed run; existing output files cannot be overwritten. The output file is created with owner-only permissions and excluded from Git by default. It can contain private briefs and passages; keep it private. Usage, elapsed time, findings, source references and failure states are recorded. Raw provider errors and API keys are not printed. An interrupted file lacks the final complete record; do not treat it as a finished comparison.

Every output retains `qualityVerdict: requires_human_review`. Passing transport/schema checks never awards a research-quality pass. For release evaluation, replace/extend controls with reviewed SEC/CVM English/Portuguese tasks, annual/interim/amendment cases, missing evidence and circular sources. Compare profiles using the same reviewed corpus and repeated trials; measure claim support, source/period correctness, appropriate abstention, counterevidence, reviewer effort, usage/cost per successful report and latency. Review disagreements. Do not use the same model as the sole evaluator. Keep the rubric disabled until the reviewed comparison justifies it; no accuracy gain is claimed by this implementation.

The live runner also disables the issuer-primary adapter in its own process, so an inherited production flag cannot add a fresh Apple statement to the frozen dataset.

## Source provenance and license

Concepts adapted from `Santos123-Sys/agency-agents` at commit `4e3ac3ca6604c75113f52c695dbddcc7af928b46`:

- `research/research-synthesist.md`: trace source origins, distinguish repetition from corroboration and disclose gaps.
- `finance/finance-investment-researcher.md`: falsifiable thesis, countercase, horizon and catalysts; calculation/sizing/ratings/fictional experience excluded.
- `academic/academic-statistician.md`: causal alternatives, assumptions and uncertainty; no statistical calculator imported.
- `engineering/engineering-prompt-engineer.md`: versioned prompts and paired evaluation; private-reasoning instructions and arbitrary quality targets excluded.

Pinned source: <https://github.com/Santos123-Sys/agency-agents/tree/4e3ac3ca6604c75113f52c695dbddcc7af928b46>.
Retain [the upstream MIT notice](licenses/agency-agents-MIT.txt). No upstream repair, RAG or orchestration code is executed or vendored.
