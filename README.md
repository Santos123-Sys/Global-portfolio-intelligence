# GPI — Discovery & Research Foundation

GPI filters candidates and challenges evidence. **FilingLens owns financial facts, calculated indicators and valuation.** Coverage is limited to USA/SEC and Brazil/CVM. Swiss coverage, internal valuation, portfolio calculations and automatic trading are removed from the active application.

This replaces the previous application; it is not the previous dashboard with an additional panel. Existing login security (revocable sessions, scrypt, MFA, tenant membership, CSRF and CSP) is retained. Existing database records are not deleted. Source history is preserved in `recovery/pre-foundation-main-2026-10-09`.

## Run locally

Node 22+, PostgreSQL, and runtime secrets are required. Copy `.env.example` to `.env.local` for Next.js; command-line scripts need those variables exported or `node --env-file=.env.local --import tsx ...`.

```sh
npm ci
npm run db:migrate
npm run admin:create:if-configured
npm run dev
# In a separate process with the same database/configuration:
npm run worker
```

The migration is additive and repeatable. It creates the identity tables if absent and the new `gpi_foundation_workspaces` / `gpi_foundation_jobs` tables. It does not drop legacy tables, change passwords, or rewrite legacy research.

## Implemented

- Investor profile: selected markets, growth threshold, evidence age, optional liquidity requirement.
- Sourced seventeen-listing starter watchlist, JSON import, canonical CIK/CNPJ identities or explicit unmapped state. It is **not** a complete market universe. Brazil mappings require verification; no CNPJ guesses are shipped.
- Profile-driven staged screening with source-linked PASS / FAIL / UNKNOWN / NOT_REQUESTED. Revenue growth is received from FilingLens, never calculated here. Requested liquidity or unsupported income/preservation inputs remain unknown.
- Persistent, account-scoped screen/research jobs; idempotency conflict detection, three-active-job and twenty-five-daily-job caps, worker leases and fenced terminal writes. Worker loss fails expired work rather than replaying a potentially charged model call.
- Research evidence packs with bull/countercase questions, optional single-call qualitative draft, fact-ID validation and mandatory human review. Source values, dates and units are rendered separately without recomputation.
- Secure public FilingLens v1 reader: HTTPS, GET only, digest/issuer/source validation, bounded response size, two attempts under one deadline. Private uploads and valuation commands are not accessed.

## Deliberate gaps

The FilingLens producer contract was prepared in earlier local work but **is not deployed or modified by this replacement**. Live readings require its separately approved release and dedicated token. GPI honestly reports disabled/unavailable until then. No imaginary valuation endpoint is used.

Automatic SEC/CVM universe refresh, full liquidity/trend/relative-strength screens, dividend/stability indicators, document retrieval and automated claim-entailment checks remain future work. Optional model output is a hypothesis for human review; valid citations do not prove truth. No production latency or reliability claim is inferred from offline tests.

## Verify and release

```sh
npm run lint
npm run typecheck
npm test
npm run build:worker
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit, embedded PostgreSQL, route-security and browser tests are included. Browser tests use synthetic evidence and mock only the signed-in data service; they do not establish real FilingLens connectivity.

Railway configuration: dashboard uses `railway.dashboard.json`; one worker uses `railway.foundation-worker.json`. **Before merging to an auto-deployed branch**, stop retired agentic-api / old worker / filings-python services and reconfigure the worker build/start commands. Preserve PostgreSQL, user credentials and dashboard secrets. This repository change does not perform the Railway cutover.

Rollback by reverting the replacement commit or redeploying the recovery branch. New tables can remain: there is no destructive down-migration. Do not force-push or drop the database.

See [architecture and delivery status](docs/foundation-architecture.md) and [ZIP provenance](docs/zip-provenance.md).

Local evidence: [verification results](docs/verification-results.md). These checks do not substitute for the production cutover gates.
