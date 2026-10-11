# FilingLens issuer-primary bridge — GPI

## Status and data authority

GPI renders a distinct, source-verified Apple FY2025 issuer-published
financial disclosure, never pretending it is SEC CompanyFacts.
The regulator-only FilingLens financial snapshot contract and its
`FILINGLENS_READ_ENABLED` flag remain unchanged and disabled until an
authorized SEC/CVM archive has been imported.

The Apple document is issuer-published **unaudited**, not an audited
10-K financial record. A source-hash match and deterministic comparison
verify the issuer PDF contents, not SEC authentication or an audit opinion.

## Scoped API

`GET /api/integration/v1/issuer-statement?candidateKey=XNAS:AAPL`

Requires a signed-in GPI session and a matching candidate in that account's
saved watchlist. The server resolves an exact Apple CIK and SEC accession
identity, using either the updated starter data or a fixed legacy Apple
starter-identity compatibility mapping. It never accepts a caller-supplied
CIK and rejects mismatched candidates.

Server-to-server reader:
`GET /api/integration/v1/issuers/us/0000320193/issuer-statement`

The reader requires HTTPS, a dedicated >=32-character token, a bounded
response, schema validation and an exact SHA-256 envelope digest. It
cross-checks the accepted issuer PDF's hash and does not allow alternate
provenance/SEC verification labels.

## Railway variables — separate rollout

- `FILINGLENS_ISSUER_PRIMARY_READ_ENABLED=false` by default on GPI.
- `FILINGLENS_ISSUER_PRIMARY_ENABLED=false` by default on FilingLens.
- `FILINGLENS_API_URL`: exact HTTPS FilingLens public origin.
- `FILINGLENS_READ_API_TOKEN`: same server-only token on both services.
- `FILINGLENS_READ_ENABLED=false` remains regulator-facts-only, independent.

No API token is sent to the browser or included in candidate records.
A missing/corrupted source returns an explicitly unavailable state and does
not cause a screening PASS or an automated investment decision.

## Validation

1. GPI/FilingLens CI tests and production build.
2. Confirm no-secret call receives 401 from publisher when enabled.
3. Confirm a real Apple FY2025 PDF fetch and pinned hash match at publisher.
4. Confirm authorized publisher returns 200; GPI accepts exact schema+digest.
5. Confirm GPI account isolation, legacy watchlist compatibility and
   changed source/provider/digest rejection.
6. Only then enable the two distinct issuer-primary rollout flags.

The original regulator-only 404 remains a valid status until actual
SEC CompanyFacts/CVM regulator records are securely archived.
