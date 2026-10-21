# Brazilian primary-source API bridge

Problem tree: (1) instrument identity and complete catalog, (2) primary fundamentals, (3) price/event quality and consumption. The bridge addresses catalog exposure and primary financial evidence without claiming that a catalog listing certifies a price history.

Authenticated `GET /api/integration/v1/brazil-data?offset=0&limit=100` pages the current BrAPI catalog. A 15-minute shared process cache prevents per-page reacquisition. Every instrument retains its original symbol; unfamiliar/fractional symbols require review. Issuer, fundamentals and risk eligibility are explicitly not evaluated.

Authenticated same-origin `POST /api/integration/v1/brazil-data` forwards a bounded `issuers`, `facts` or `screen` query to FilingLens's `/api/integration/v1/brazil/fundamentals`. FilingLens owns the CVM bulk archives, normalization and provenance. The existing service read token remains server-only. The bridge validates schema version, official CVM source origin, SHA-256 receipt and requested issuer identity. Read operations do not modify workspaces or approve portfolio data.

Example body: `{"operation":"facts","cnpj":"33000167000101","form":"ITR","year":2026,"scope":"consolidated","offset":0,"limit":100}`. Follow `nextOffset`. Annual/year, quarter/YTD, consolidated/standalone and source-versus-verified distinctions are retained. Unknown `asOf` parameters are rejected; no point-in-time claim is made.

Dependency: merge/deploy FilingLens's primary fundamentals API before the first production query. No changes to Risk Studio's calculation bundle or financial-data gates are required by this read-only bridge. Existing per-instrument five-year price/event validation remains mandatory. Full B3 certification still requires independently adequate price/event entitlements and reviewed identity coverage.
