# Thesis workflow: architecture and review decisions

## Research basis

- CFA Institute, Basics of Portfolio Planning and Construction: https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/basics-of-portfolio-planning-and-construction
  Investment policy separates objectives from constraints, including horizon, liquidity, tax/regulatory factors and unique needs. These are review prompts, not invented default investment restrictions.
- OpenAI, Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
  Schema adherence does not establish factual correctness. The existing schema-constrained extraction still needs deterministic business checks and human review.

## Keep

Source validation, asynchronous extraction, source excerpts and unmapped-content reporting, explicit human confirmation, immutable thesis versions, owner-scoped transactions, and a discovery transition pinned to the newly confirmed version. Confirmation and discovery remain separate outcomes, so a provider failure does not undo a saved mandate.

## Change

Previously, only currency was editable even though extraction ambiguities required judgment. The review editor now covers destinations, objectives, currencies, inclusion/exclusion lists, global constraints, and existing target values; mandates can be added or removed. Source extraction is available beside the editing flow. Numeric constraints retain their source units and periods as text rather than being silently converted.

A shared pure review function produces normalized criteria, blocking errors and advisory warnings. The browser previews it; the API enforces it independently before a transaction. Blocking errors include duplicate destinations, blank objectives/metric values, invalid currency syntax, currency mismatches for configured mandates, and identical criteria appearing in both inclusion and exclusion lists. Unsupported markets are warnings and are retained in the thesis.

For a linked extraction with ambiguous or unmapped content, confirmation requires a review disposition. The note must explain corrections, retained interpretation or deferred content; it is not an assertion that every uncertainty has vanished. The audit captures the complete original extraction and confirmed criteria, notes, warnings and prior-version reference. Confirmed criteria can be exported as JSON with version identity and effective date.

Input confirmation bodies are bounded to 128 KiB. Structured data remains canonical; the PDF remains a document artifact. No model confidence threshold automatically authorizes confirmation.

## Input and output boundaries

1. Document input: existing PDF/text validation and extraction produce a draft, confidence estimate, ambiguities and unmapped content.
2. Review input: editable mandate plus an explicit disposition when needed.
3. Validation output: normalized criteria, blocking errors and advisory warnings.
4. Confirmation output: immutable version, audit evidence and an independent discovery-transition result.
5. Export output: confirmed criteria JSON with thesis version ID and effective date.

## Not adopted in this change

Additional agents cannot resolve missing investor intent reliably. Automatic thresholds based on self-reported confidence would create false certainty. Automatically supplying missing constraints would change the mandate without evidence. Natural-language contradictions and actual currency-code registry membership require more than these syntactic checks.

The generated-PDF-to-extraction path still adds latency and a second interpretation of structured answers. A future direct authoring path should introduce an explicit draft source type and preserve questionnaire provenance before bypassing extraction; it should not impersonate a completed remote extraction. This PR improves the common review boundary for both entry paths without changing that lifecycle contract.
