# Agent operations, budgets and worker-pool evidence

The production architecture keeps one agentic worker and the existing logical
specialists. It does not add another agent or a continuously deployed worker
pool without measured demand.

## Aggregate session budget

Every Responses API call made by a canonical research session is reserved
against one shared session budget, including calls made concurrently by dynamic
research specialists and shadow evaluations. The reservation happens before the
provider request, so parallel branches cannot each spend the final available
call. Usage is persisted after every response and across worker retries.

Default hard ceilings are safety limits, not performance targets:

| Analysis type | Model calls | Active runtime |
| --- | ---: | ---: |
| DCF | 16 | 15 minutes |
| Quick | 64 | 15 minutes |
| Fundamental | 112 | 30 minutes |
| Combined | 128 | 45 minutes |

Operators may set `AGENT_SESSION_MAX_MODEL_CALLS` and
`AGENT_SESSION_MAX_ACTIVE_MS` to impose one global ceiling. Token and cost
ceilings are intentionally opt-in through `AGENT_SESSION_MAX_INPUT_TOKENS`,
`AGENT_SESSION_MAX_OUTPUT_TOKENS`, and
`AGENT_SESSION_MAX_ESTIMATED_COST_USD`; they should be set from measured
production distributions rather than invented estimates.

Provider token usage is stored as input/output totals. A response without usage
metadata increments `unmeteredModelCalls` instead of silently recording zero.
Estimated cost remains `null` unless `AGENT_MODEL_PRICING_JSON` contains an
operator-approved rate for the exact model name.

Crossing any hard ceiling fails the session with a bounded, visible error and a
semantic session event. Completed output includes the frozen limits and final
usage snapshot used for that run.

## Operational proof

The platform-admin Research Operations screen reports a rolling 24-hour view:

- canonical queue depth, running count and oldest queued session;
- p95 wait from session creation to the worker's first claim;
- canonical worker occupancy derived from persisted active session runtime;
- completed/failed sessions and aggregate model calls, tokens, unmetered calls,
  and cost when pricing is configured.

The worker `/health` endpoint reports process-lifetime busy ratio and separate
canonical/preparatory queue depth, running count and oldest queued age. This
makes discovery starvation while canonical analysis runs directly observable.
The endpoint is private; Railway's deploy healthcheck proves readiness, while a
continuous private monitor must poll it to detect a live process that later
wedges.

## Decision gate for a second worker pool

The admin screen produces one of `collecting evidence`, `hold`, or
`consider second pool`. The last state requires all of the following over the
rolling measurement window:

1. At least 20 canonical sessions and at least one observed hour.
2. Canonical session queue wait p95 is at least 120 seconds.
3. Canonical worker occupancy is at least 70 percent.

Before deploying a separate preparatory pool, also confirm repeated worker
health snapshots where the preparatory queue's oldest wait grows while a
canonical session is running. This separates an architectural contention
problem from a temporary provider slowdown.

The gate is advisory: it records enough workload to justify review but does not
provision or autoscale a service. Change thresholds only through a reviewed code
change with the before/after telemetry attached.

## Deployment verification

1. Run migrations before the dashboard and worker start. Migration `0027`
   adds the persisted budget and usage fields.
2. Confirm the worker log says the canonical finance runtime is ready.
3. Start one controlled quick analysis and verify model calls/tokens increase,
   the session completes within its budget, and `/health` shows both queues.
4. Confirm Research Operations shows the session in the rolling sample. New
   deployments will initially say `collecting evidence`; that is expected.
5. If cost reporting is required, configure `AGENT_MODEL_PRICING_JSON` with the
   current contracted rates and verify the exact deployed model key matches.
