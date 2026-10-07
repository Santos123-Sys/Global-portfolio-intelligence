# Canonical worker readiness contract

## Proposal and scope

The 2026-10-07 production inventory has no `FINANCE_DATABASE_URL` on
`agentic-worker`. Its existing optional import therefore disables canonical
analysis while the preparatory queue still reports online. This increment
restores the existing Research Director deployment, rather than adding a new
orchestrator or changing the public research contract.

This proposal covers the dashboard-owned finance runtime and Railway definition
and the agentic-owned worker startup. The worker already owns execution of the
bundled runtime against the explicitly configured finance database. No new
cross-service data writes or API contracts are introduced.

## Acceptance criteria

1. Production configuration rejects a missing finance database with an actionable
   field name. Local preparatory-only development remains possible.
2. The worker awaits the runtime import, environment validation and queue-table
   reads before opening its health socket or logging readiness. Startup rejection
   reaches the existing process failure handler.
3. Startup checks read no research content, perform no model calls and create no
   jobs. Normal queue processing and human approval gates remain unchanged.
4. Railway supplies finance database and runtime settings through existing service
   references; secrets never enter Git or logs.
5. Regression tests cover production misconfiguration, pending initialization,
   failed initialization and the database readiness probe. CI must pass before
   the authorized PR merge.

## Release and rollback

Configure the worker references without deploying, then merge the verified PR.
Use `/health` as a deployment readiness gate. Confirm startup logs include
`Canonical finance runtime ready` and verify the live deployment succeeds.
Railway healthchecks run at deployment time, not continuously:
https://docs.railway.com/deployments/healthchecks#continuous-healthchecks.

Rollback means reverting this increment and redeploying the previous image.
Retain the finance references: removing them recreates the dormant queue.
No migration or data deletion is required. This change does not establish that
live model outputs are accurate; an authenticated issuer-analysis acceptance run
is a separate validation activity.

## Ordered follow-up backlog

- Run a retained-filing analysis and inspect progress, evidence and approval gates.
- Separate long analysis and preparatory scheduling if queue latency warrants it.
- Add continuous queue-age monitoring and failure alerts with measured thresholds.
- Evaluate UX improvements from observed workflow friction.
