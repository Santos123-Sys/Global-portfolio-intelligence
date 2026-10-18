# Browser VM activation evidence

Production browser admission remains disabled pending the gates below.

## Observed runtime results (2026-10-18)

The ordinary Railway staging container failed Chromium sandbox startup with
`credentials.cc:131 Permission denied (13)`. The sandbox was not disabled.
A temporary Railway sandbox VM ran the real Chromium fixture three times as
non-root `browsercheck` with `NODE_ENV=production`: all passed (3753, 1109,
705 ms), with 22417-byte frames. These checks do not verify a live model.

The credential-free staging checkpoint `gpi-browser-verified-20261018-8a26ef4a`
contains the experimental runtime. Ubuntu 26.04 required a VM-only Playwright
1.64.0 installation; at that measurement the repository was pinned to 1.56.1.
The follow-up implementation pins both runtime/test packages to 1.64.1 and adds
a reproducible SDK recipe. See browser-runtime-plan.md for its live release gates.

## Bounded live-model check

Run `node --import tsx scripts/verify-browser-model.ts` with authorized
`RESEARCH_MODEL_API_KEY` and `RESEARCH_MODEL_NAME` in the isolated runtime.
It permits at most six model calls over two minutes and requires exact captured
evidence followed by finish. Sources are synthetic; model calls are real.
It writes no database or corpus records and logs only action/usage receipts.

The user explicitly authorized staging model credential references in a
temporary staging VM followed by VM destruction. The initial test requested
a revenue passage absent from the fixture and failed to finish in six calls.
The corrected test asks about maintenance contracts and customer retention.
A rerun passed: link → exact capture → finish, 3 calls, 1450 tokens,
7535 ms. The key-bearing VM `6a09a0ef-db85-4b6d-be42-b68c004c7d4a`
was explicitly destroyed and confirmed; all three earlier VMs were also read
back as DESTROYED. No credential-bearing checkpoint was created.

## Native database repair and admission

Native PostgreSQL 18 testing exposed a bug hidden by the PGlite adapter:
`JSON.stringify(value)` sent directly to an inferred `jsonb` parameter was
serialized again by postgres.js. Rows became JSON strings, so queued runs
were invisible to the worker's state query. All browser payload writes now
use an explicit text intermediate before conversion to JSONB. Migration 006
repairs earlier encoded browser records without discarding receipts.

Workers advertise five-second readiness leases only after a real sandboxed
Chromium preflight and model configuration checks. Admission and claims share
an advisory lock; queued tasks reserve idle capacity, busy or expired workers
cannot admit new work, and retries can still retrieve their existing run.
This proves recent runtime availability, not an OpenAI entitlement check or
whole-VM replacement. A worker can fail after admission; expiry reconciles
that uncertainty without automatic replay.

`verify-browser-postgres.ts` uses only a disposable loopback database. Observed:
six competing admissions → one acceptance; two separate processes → one claim;
a SIGKILL while holding a row lock → lock released, expired run reconciled,
claimed command not replayed. It also verifies native JSON object persistence
for sessions, commands, events and observations and duplicate command handling.
The repair migration was applied twice to simulated double-encoded records
and restored all four payload types. The same check is now a CI gate against
PostgreSQL 16. Browser control regressions: 31/31 passed, including actual
authenticated React canvas/SSE and Chromium takeover/stop. General suite:
217 passed, four opt-in tests skipped; type checking and lint passed (one
existing JSX punctuation warning).

## Supervision follow-up

The unverified systemd preparation artifact was removed. The managed VM controller,
lease fences, bounded recovery and signed-in verification page are described in
[browser-runtime-plan.md](browser-runtime-plan.md). Historical fixture results
above do not establish that the new controller was provisioned and verified live.

## Remaining activation gates

- Reproducible runtime matching validated dependencies.
- Supervised browser process restart and whole-VM replacement, including actual
  browser-process loss while a source action is executing.
- Authenticated streaming, takeover, resume, stop and corpus review workflow.

Passing the synthetic model check alone does not satisfy production readiness.
