# Thesis contract extension — 27 September 2026

This proposal precedes cross-boundary implementation. Extend the existing ThesisPortfolioCriteria with an optional policy object, preserving legacy JSON and immutable historical versions. No parallel canonical thesis model.

Policy contains named mandate fields, four separate geography dimensions, typed hard/preferences/context criteria, explicit numeric predicates with units and periods, macro/risk/valuation categories, and holdings limits. The shared contract package owns validation, ambiguity detection, deterministic eligibility and discovery projection. Dashboard previews the same interpretation used by the service. Unknown evidence never establishes compliance; preferences and context never reject candidates. No fabricated thresholds or inferred nationality from currency.

New approvals require review of ambiguities; old stored versions remain readable. New direct drafts bypass PDF conversion, with explicit source identity in audit. Confirmation retains advisory owner lock and immutable snapshots. Discovery dispatch uses the same owner lock and checks active version after provider loading. Historical runs stay pinned to their original version.

Deploy shared contract, dashboard and agentic service together. Optional additive policy fields require no migration of existing thesis JSON. Draft persistence, if added, uses a separate owner-scoped table with revision checks and an explicit migration. AI extraction retains the existing compatible output schema; users structure extracted prose during review rather than relying on automatic strategy reinterpretation.
