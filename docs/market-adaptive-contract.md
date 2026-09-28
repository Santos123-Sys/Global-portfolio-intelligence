# Market-adaptive Analysis contract proposal

The uploaded `market_adaptive_factory.zip` supplies the architecture. Implement it in the existing TypeScript dashboard, shared contract and agentic service, retaining service ownership and the approval boundary.

- Extend the grounding bundle with optional, validated six-axis market context and sourced valuation inputs. Missing axes remain unknown. Existing saved bundles remain readable.
- Version market profiles and agent contracts in the shared package. Combine applicable jurisdiction/accounting/exposure modules without blending discount rates across currencies. Add Switzerland to preserve the deployed workflow.
- Plan a deterministic dependency DAG. The service executes specialized reasoning modules with schema-validated, evidence-linked claims; it records blocked modules and reconciles findings. Mathematical results come from deterministic shared engines.
- Attach the actual plan, executions, validation and reconciliation to the persisted Analysis output. The dashboard displays a concise market review, missing inputs and valuation requirements.
- Wire sourced cost-of-capital inputs into the existing DCF review and enforce the same market validation in the valuation API. Retain existing FCFF and comparable engines; add general FCFF/FCFE and cost-of-capital primitives where absent.
- Correct prototype defects: no `eval`, no automatic fresh date for stale risk tables, no sovereign rating inferred from corporate interest coverage, no nominal cash flows discounted at an unadjusted real yield, no automatic CRP addition to debt already containing sovereign risk, no currency-blended WACC, no silent dependency skips.

No cross-database writes. Deploy contract and service before dashboard. Existing valuation snapshots remain historical; new valuations capture profile version, context, provenance and validation.
