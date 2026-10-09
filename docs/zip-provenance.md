# ZIP provenance and adoption decisions

Pinned user-provided source archives inspected directly on 9 October 2026:

| Archive | SHA-256 |
|---|---|
| stock-screening-projects (1).zip | `0328ce871b6ff597b6f4d585fd34dfc0a583cfec19b52a51aea392256a0125e6` |
| deep-research-projects.zip | `f33eeb8cde8cf7b578aa48fa8e748abcab190f07807bcafb757348073d8b8906` |

| ZIP source | Foundational use | Excluded |
|---|---|---|
| growth-stock-screener `screen/iterations/revenue_growth.py`, `liquidity.py` | Original TypeScript adaptation of staged, profile-parameterized gates and explicit missing evidence | Quarterly revenue calculation, strength-based bypass, XPath scraper, dataframe runtime |
| TradingAgents `agents/researchers/bull_researcher.py`, `bear_researcher.py`, `schemas.py` | Evidence/counterevidence perspectives, explicit handoff, falsifiers and human review | Python graph framework, autonomous trader, repeated debate, persistent model memory |
| ai-hedge-fund `hedge_fund/portfolio/validation.py` | Boundary validation and reject unsupported output principle | Portfolio sizing, persona-agent proliferation, order execution, backtesting calculations |
| OpenBB | Evaluated provider boundary; future SDK adapter only after a validated market-data contract | Full monorepo, desktop application, unlicensed provider assumptions |
| FinRobot | Evaluated reporting role | Its valuation calculators and optional noncommercial assets; FilingLens is valuation authority |

No third-party framework code or original prompts are copied verbatim. The growth-screener MIT license is retained conservatively for the adaptation. TradingAgents and FinRobot ZIP top-level licenses show Apache-2.0; ai-hedge-fund shows MIT. The supplied OpenBB top-level license also shows Apache-2.0, contrary to the companion plan's AGPL statement. This observation does not audit every asset, dependency or data entitlement.

The companion plan's illustrative finance endpoints are not assumed to exist. The only implemented consumer is the explicitly versioned public FilingLens snapshot contract. The prior plan proposed five services; this foundation deliberately uses one dashboard and one worker until measured queue pressure justifies more services.

The starter identities are a USA/Brazil-only extraction from the repository's previously sourced 25 September 2026 snapshot. Financial geography and valuation data from that snapshot are not copied. CNPJ mappings are absent until verified. No live completeness or identity-refresh claim is made.
