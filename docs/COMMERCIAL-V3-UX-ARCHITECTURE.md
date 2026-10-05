# Commercial V3 UX and Product Architecture

## Objective

Global Portfolio Intelligence should behave like an investment operating system, not a collection of disconnected pages. The interface must make three things continuously obvious:

1. What the user is doing now.
2. What the system/agents are doing now.
3. What must happen next before an investment decision is valid.

## Product flow

`Mandate → Discovery → Research → Decision → Portfolio → Monitoring`

The product shell owns navigation and progress. Individual pages own domain work, but they do not invent their own global workflow semantics.

## Experience principles

- Progressive disclosure: show the decision first, supporting detail second, raw evidence last.
- One status vocabulary across the product: `ready`, `working`, `attention`, `blocked`, `complete`.
- One action hierarchy: one primary action per workspace, secondary actions grouped separately.
- No validator language in the primary UX. Internal diagnostics belong in audit detail.
- Agent work is observable: current phase, progress, evidence state, blockers and next transition must be visible.
- Human approval remains explicit for mandate approval, candidate promotion and portfolio decisions.
- Research evidence and machine-enforced rules are visually distinct from preferences and contextual guidance.

## Workspace model

### 1. Strategy workspace

Primary question: **What mandate should govern research?**

Surfaces:
- Strategy status summary.
- Mandate metadata.
- Universe constraints.
- Eligibility gates.
- Ranking preferences.
- Risk/context guidance.
- Evidence checks.
- Research Director audit.
- Version delta.
- Approval controls.

### 2. Discovery workspace

Primary question: **Which securities deserve research under the approved mandate?**

Surfaces:
- Readiness gate.
- Live Research Director execution.
- Market coverage and limitations.
- Candidate funnel.
- Candidate decision cards.
- Evidence quality.
- Market brief and analysis transition.

### 3. Research workspace

Primary question: **What changed in the investment case?**

Surfaces:
- Research ledger.
- Current/changed/violated views.
- Evidence quality and thesis fit.
- Version history.
- Links to decision and portfolio state.

### 4. Portfolio workspace

Primary question: **What do we own, why, and what threatens the thesis?**

Surfaces:
- Positions and allocation.
- Risk.
- Governance.
- Monitoring triggers.
- Decision history.

## Agentic control architecture

The canonical orchestration model is:

`Mandate / Allocation`
→ `Universe`
→ `Evidence Eligibility`
→ `Ranking`
→ `Research Director`
→ `Dynamic Specialists`
→ `Bull / Bear`
→ `Judge`
→ `Constraint Audit`
→ `Human Review`

Rules:
- Each user instruction has one canonical owner.
- Hard eligibility rules must have a deterministic metric predicate or a source-backed evidence predicate.
- Preferences influence ranking but never silently exclude a security.
- Context never becomes an eligibility gate.
- Missing evidence for a hard rule fails closed as `unverified`.
- Cross-domain conflicts are resolved in the audit layer, not duplicated across agents.

## Information architecture

Persistent sidebar:
- Overview
- Strategy
- Discovery
- Research
- Portfolio
- Governance
- Operations
- Settings

Context bar:
- Current workspace title.
- Portfolio/account context.
- Global workflow state.
- Theme/language/account controls.

## UI status model

| Status | Meaning | User implication |
| --- | --- | --- |
| Ready | No blocking issue | Primary action is available |
| Working | Agent or service is executing | Observe progress; no duplicate request |
| Attention | Non-blocking judgment/evidence gap | Review before relying on result |
| Blocked | Hard prerequisite missing | Resolve before continuing |
| Complete | Stage finished | Move to the next workflow stage |

## Implementation boundaries

- Dashboard never executes agent prompts directly.
- Quant remains deterministic and independent from integrations.
- Agentic-service and dashboard databases remain separated by the existing callback/manifest contracts.
- Existing public interfaces remain backward compatible unless a versioned migration is introduced.
- Internal UI refactors are gated by unit, type, build and E2E tests.
