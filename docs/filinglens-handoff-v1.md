# FilingLens issuer evidence handoff — GPI milestone 1

## Ownership and scope

GPI screens USA/SEC and Brazil/CVM companies and stores human research decisions. FilingLens alone supplies regulator-backed financial facts and computed screening inputs. This milestone adds a **read-only, on-demand issuer evidence view** to GPI's authenticated candidate watchlist; it does not start a FilingLens analysis, publish valuations, grant approvals or transfer private document uploads.

The existing FilingLens producer is:
`GET /api/integration/v1/issuers/{us|br}/{CIK|CNPJ}/financial-snapshot`.
GPI's server-side client verifies bearer authorization, JSON schema, official regulator source domains, issuer identity, content digest, time/size limits and canonical ID rules. The displayed facts are exactly the publisher's values and units, not GPI recalculations.

## GPI route

`GET /api/integrations/filinglens/issuer?candidateKey=XNAS:AAPL`

- Requires an active GPI session and reads the current account's saved watchlist.
- Rejects arbitrary client-supplied ticker/CIK/CNPJ (only a saved candidate key is accepted).
- Uses the server-side verified CIK/CNPJ crosswalk. If an imported issuer conflicts with the verified crosswalk, returns 409 `issuer_identity_conflict` without publishing facts.
- `ready` returns the publisher's full validated public snapshot. `disabled`, `identity_unmapped`, `unsupported_market` and `unavailable` are explicit; missing data never passes screening.
- Private, no-store response. The browser receives no integration token.
- No financial calculations or automation of valuations/trading.

The watchlist shows up to 30 regulator-linked facts for quick review; the stored screen/research evidence pack remains the full record.

## Deployment prerequisites

Set these on **GPI dashboard and worker** independently, using protected Railway service variables:

- `FILINGLENS_READ_ENABLED=true` only after successful staging proof.
- `FILINGLENS_API_URL` the verified HTTPS FilingLens origin, with no path/query.
- `FILINGLENS_READ_API_TOKEN` dedicated matching server-side bearer token provisioned on FilingLens; never browser-exposed.
- `FILINGLENS_ISSUER_MAP_JSON` operator-verified mappings keyed by `MIC:TICKER`. No ticker-to-CIK/CNPJ guessing.

FilingLens needs `DATABASE_URL`, `FILINGLENS_READ_API_TOKEN`, the public finance API route and actual archived SEC/CVM facts. A healthy `/api/integration/v1/capabilities` is not proof a specific issuer has data.

## Release gates

1. GPI lint, typecheck, unit/security tests, production build and mobile/desktop smoke.
2. A valid authorized US CIK response and Brazilian CNPJ response with matching source periods and digest.
3. Unauthorized bearer request is 401; unmapped/missing issuer is explicit (404 or mapped UNKNOWN), mismatching issuer blocked.
4. Staging smoke from authenticated GPI login to the new watchlist preview; upstream outage returns unavailable.
5. No private file content, account identity or bearer secret transmitted to the browser or stored in fact previews.

## Next milestone

Add durable, human-reviewed FilingLens valuation versions and an asynchronous analysis request lifecycle **only when FilingLens implements their authenticated APIs and approval database records**. GPI will then offer an explicit user-requested handoff; it must not pretend a public financial snapshot is an approved valuation.
