# PR #134 verification checklist

This change is complete only when the repository's full CI gate passes.

## Authority invariants

- New security/company analysis is persisted only as `agent_analysis_sessions`.
- `Research Director` is the only production orchestrator for specialist research, adversarial debate and synthesis.
- Generic agentic `process-job` executes extraction, market discovery and market briefs only.
- New `/v1/analysis-runs` creation and retry return HTTP 410.
- Historical legacy run status and report reads remain available.
- Discovery candidate approval creates a canonical session linked by `analysis_session_id`.
- Candidate research uses `fundamental` analysis; deterministic valuation remains separately human-authorized.

## Required CI

- Python finance/portfolio tests
- portfolio weights demo
- production dependency advisory gate
- ESLint
- TypeScript
- agentic build
- dashboard/unit suite
- agentic service suite
- Next.js production build
- Playwright browser E2E
