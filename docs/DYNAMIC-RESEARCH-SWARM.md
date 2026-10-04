# Governed Dynamic Research Swarm

## Purpose

The dynamic research swarm adds Kimi-style runtime task decomposition to the research-analysis layer without replacing the platform's governed investment-research architecture.

The Research Director remains the orchestration authority. Deterministic financial-statement and valuation tools remain deterministic. Dynamic specialists are temporary, research-only workers whose outputs flow into the existing Analysis Swarm, opposing bull/bear cases, judge, Independent Reviewer workflow, and human approval controls.

## Flow

```text
Confirmed portfolio strategy / thesis
            |
            v
     Research Director
            |
    deterministic baseline
            |
  +---------+-------------------+
  |                             |
  v                             v
Financial statement       Market/industry
analyzer                   research module
  |                             |
  +-------------+---------------+
                |
                v
        Dynamic decomposition
                |
      bounded parallel swarm
   +------+-------+------+------+
   |      |       |      |      |
   v      v       v      v      v
competition demand management risk countercase ...
   |      |       |      |      |
   +------+-------+------+------+
                |
                v
       governed Analysis Swarm
                |
          bull / bear cases
                |
                v
              judge
                |
                v
       human review / approval
```

## Bounded scaling

The system does not equate more agents with better research.

| Analysis type | Maximum dynamic tasks |
| --- | ---: |
| DCF only | 0 |
| Quick | 3 |
| Fundamental | 6 |
| Combined | 8 |

The planner is asked to avoid duplicate or spurious parallelism. If the planner model is unavailable or produces an invalid plan, deterministic sector-aware decomposition is used so the workflow remains available and auditable.

## Dynamic specialization

The planner receives only research-planning context: issuer, market, sector, thesis, evidence inventory, known data gaps and the task budget. It cannot approve investments or produce valuation conclusions.

Examples of runtime specialization include:

- semiconductor demand/capex cycle and supply-chain dependence;
- bank credit/funding quality and regulatory capital resilience;
- healthcare pipeline/patent durability and reimbursement risk;
- energy commodity/cost-curve exposure and capital discipline;
- consumer pricing/volume/mix and channel durability;
- cross-sector competitive position, management/capital allocation, risk and explicit countercase research.

## Isolation and anchoring control

Each dynamic task runs through the single protected `dynamic-research-specialist` execution identity but is persisted under a unique run name such as `dynamic-research-supply-chain`.

Dynamic workers receive:

- the retained issuer evidence selected for their task;
- deterministic financial-statement output;
- governed market/industry output;
- the confirmed thesis context.

They do **not** receive sibling dynamic-worker outputs. This prevents a parallel worker from anchoring on another worker's conclusions. Once validated, their artifacts become available to the downstream synthesis specialists, bull/bear cases and judge.

## Evidence and quality controls

Dynamic specialists inherit the same protected policy as the rest of the research architecture:

- retained evidence only;
- exact citation/excerpt linkage for material claims;
- explicit fact/inference/assumption classification;
- no invented sources, thresholds, market size or valuation numbers;
- no trading or portfolio-weight authority;
- independent quality verification before an artifact is accepted.

A dynamic task that lacks evidence reports `insufficient_data`; it is not allowed to convert absence of evidence into a conclusion. High-priority unresolved dynamic tasks cause the final research status to remain `insufficient_data`.

## Synthesis

Validated dynamic artifacts are included in the canonical equity-research object and are passed to the existing fundamental, technical, sentiment, ratio and quality specialists as relevant predecessor evidence. They also feed the opposing bull/bear cases and judge.

Dynamic outputs supplement rather than overwrite deterministic calculations. Numerical valuation continues to come from the registered deterministic valuation tools.

## Agentic UI / observability

Each dynamic task is persisted in `agent_runs` and emits the existing semantic session events:

- plan created;
- handoff;
- started;
- retry / QA failure;
- artifact created;
- completed or needs evidence review.

The session API incorporates dynamic run names into progress and pending-step calculations, so company-level live status and Research Operations continue to reflect the actual execution graph rather than the original static plan.

No private chain-of-thought is exposed. The UI receives task identity, execution status, citations, findings, limitations and evidence confidence only.

## Operational characteristics

This implementation intentionally limits swarm width because parallelism trades lower wall-clock latency for higher model/tool usage. The architecture optimizes for useful independent evidence coverage, not agent count.

The planner uses the existing `OPENAI_API_KEY` and configured Research Director runtime policy. No new environment variable or database migration is required.
