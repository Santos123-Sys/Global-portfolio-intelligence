# Approved valuation evidence in GPI

The approved per-share value in the Portfolio view opens an on-demand evidence dialog. It follows the saved FilingLens calculation graph through formulas, analyst inputs and underlying period-specific source excerpts. Graph export preserves these references as JSON. A source link means a locator is attached; it does not establish independent reconciliation, audited status or forecast accuracy.

## Authorization and contract

`GET /api/integration/v1/valuation-audit?candidateKey=...&valuationVersionId=...` requires a current GPI session. The owner/account come from that session. The route requires the valuation to be saved under that owner and account, requires its current candidate to resolve to the same canonical issuer, and then reads the FilingLens workspace-scoped audit endpoint using the existing server-only valuation service credential.

The provider contract is `{schemaVersion:'valuation-audit.v1', valuationVersionId, issuerId, lineage}`. The reader validates both outer and graph issuer identities, version, node/dependency identity, graph acyclicity, bounds, and safe HTTPS source links. The GPI route also matches the graph ticker, per-share result and currency to the locally saved approval. User-supplied workspace IDs cannot override the session scope. Responses are uncached. Provider failure, malformed data, legacy unavailable lineage or contradictions return an explicit unavailable state, without inventing source evidence.

The audit reader allows at most 512,000 response bytes and 500 graph nodes. Other provider readers retain their prior 128,000-byte cap. Source URLs exclude credentials and secret-bearing query names. No service token, capability, private provider error or browser session is returned in the audit graph.

The existing `FILINGLENS_VALUATION_READ_ENABLED`, `FILINGLENS_API_URL` and `FILINGLENS_VALUATION_READ_API_TOKEN` configuration is reused. No database migration or additional service is required. The FilingLens audit endpoint must deploy before this UI can inspect evidence; until then the dialog reports unavailable and offers retry. Existing valuation import and risk workflows remain independently usable.

## Verification

- The cross-application test uses actual GPI authentication, session, handoff, signed event, valuation import and audit-route implementations with isolated SQL engines. It asserts successful authorized audit access, another-account denial and denial after logout. Financial/risk inputs are synthetic in that test.
- Unit tests reject anonymous access, absent account records, changed issuers, wrong provider versions/identities, per-share contradictions, provider failure, unsafe source links, malformed dependencies, cycles and oversized responses.
- Browser tests at 390px and 1440px use a frozen real Apple issuer statement transcription with explicit illustrative analyst assumptions; HTTP transport is mocked. They navigate the per-share result through projected FCFF and revenue to reported FY2025 revenue of USD 416,161 million, inspect the original unaudited issuer PDF link, export the graph, close with Escape, verify focus restoration, and display provider failure without stale quotations.
- These checks are local/integration and browser-fixture verification. They do not establish a signed-in production journey, live source access, forecasting accuracy or independent verification of the analyst assumptions.

The Apple graph is built from the public FY2025 issuer financial statements and uses historical weighted-average diluted shares and explicitly simplified bridge/market assumptions. Its USD 118.74 per-share example is a reproducible calculation example, not a market price or current investment valuation.

## Release and rollback

Deploy the compatible FilingLens audit publisher first, then GPI. No migration is required. Roll back the GPI commit to remove the audit reader/dialog; previously approved valuations and portfolio snapshots remain intact. Existing records with incomplete audit evidence may show unavailable rather than exposing an unsupported citation.
