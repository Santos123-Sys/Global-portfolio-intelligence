# PR #134 — single-orchestrator migration note

The repository previously had two independently executable company-analysis authorities:

1. the generic Agentic Research Service `analysis_run` pipeline (`analyzeSecurity -> synthesizePortfolio -> manifest -> PDF`); and
2. the financial Research Director runtime (`agent_analysis_sessions -> evidence foundation -> specialists -> bull/bear -> judge -> governed synthesis`).

That duplication allowed the same security to receive materially different research behavior depending on which UI/API path initiated the work. PR #134 removes the ambiguity for all new work.

The generic service remains a preparatory research service. It continues to provide document/thesis extraction, provider-backed market discovery and bounded market briefs. Historical analysis-run reads/reports remain available, but legacy analysis creation and retry are retired.

Discovery now hands an approved candidate and approved market brief to the same durable `agent_analysis_sessions` queue used by Research Workspace. The Research Director therefore owns one evidence model, one bounded specialist/debate lifecycle, one QA path and one human-review boundary regardless of where the analysis originated.
