# Bounded Research Hub: architecture and rollout

Decision date: 2026-10-11. Confidence: 4/5 for this bounded evidence slice;
not a claim of measured investment-research quality.

## Scope and dependency structure

GPI has two entry points: the existing candidate screening flow and a new direct
Research Hub for a known company, question, language and fiscal-year window.
Both use the existing authenticated, owner-scoped durable job mechanism.
Direct research does not require passing the investor's screening preferences.

The implemented sequence is deterministic orchestration: collect validated
FilingLens records → manager plan → allowlisted evidence tools → analyst →
critic → code validation → human review. These stages depend on prior outputs;
they are not independent parallel tasks. The manager is a bounded planning role,
not an autonomous process that can spawn agents. Tools remain application-owned.

This starts the requested architecture; it does NOT implement company/year
document ingestion, SEC/CVM acquisition, full-document RAG, open-web research,
automatic gap filling, portfolio construction or presentation generation.
Current retrieval is lexical matching over structured financial records, not
semantic search. Missing data is reported, never manufactured.

## Options considered

| Design | Model calls | Strength | Principal trade-off |
| --- | --- | --- | --- |
| Existing single-call baseline | At most one | Lowest latency/cost | No distinct planning or evidence review |
| Bounded manager / analyst / critic (selected) | At most three | Explicit plan, authority boundary, review and stop conditions | Serial latency; reviewers can share model errors |
| Autonomous swarm | Potentially variable | Could explore independent research branches | No demonstrated need; harder source, budget and permission control |

There is no measured quality comparison yet. Keep the new path behind a disabled
flag until a reviewed real-source evaluation demonstrates value over the baseline.
Do not describe the critic as independent financial verification.

## Upstream research and reuse

Reviewed primary repositories and source documentation on 2026-10-11:

| Project | Observed status/license | Reused idea, not copied code |
| --- | --- | --- |
| [Open Deep Research](https://github.com/langchain-ai/open_deep_research) | Archived; MIT | Supervisor planning, scoped tasks, bounded research |
| [GPT Researcher](https://github.com/assafelovic/gpt-researcher) | Active; Apache-2.0 | Planner/executor separation, traceable source-backed reports |
| [AutoGen](https://github.com/microsoft/autogen) | Maintenance mode per README | Evaluated multi-agent runtime; not adopted |
| [promptfoo](https://github.com/promptfoo/promptfoo) | Active; MIT | Adversarial/evaluation cases; implemented with existing Vitest |

No new framework dependency or upstream code is vendored. Prompts are original
and project-specific. Retain upstream licenses if code is imported later.
Staying in the existing TypeScript worker avoids an additional Python service
without demonstrated retrieval or orchestration requirements.

## Blueprint and guardrails

- Versioned manager, analyst and critic system prompts live in
  `src/lib/research/prompts.ts`; brief, source material and prior model outputs
  are untrusted data, not instructions.
- The server resolves the candidate and obtains evidence using the existing
  FilingLens clients. Browser submissions cannot supply financial evidence.
- Strict tool schemas permit only `search_evidence` and `inspect_coverage`.
  There is no URL-fetch, shell, SQL, filesystem, secret, trading or spawn tool.
  Search arguments cannot override issuer, years or permissions.
- Issuer identity and fiscal-year filtering precede retrieval. Null/conflicted
  facts are excluded; duplicate IDs and oversized corpora fail closed.
- Optional Apple issuer-primary records remain explicitly labeled unaudited
  issuer publications, never SEC CompanyFacts verification.
- Numerical records remain deterministic source evidence. Model findings and
  falsifiers reject numeric glyphs, currency/percent symbols and URLs. Spelled-out
  numerical claims and causal support also require critic and human review;
  regex validation alone cannot prove semantic grounding.
- Every finding needs unique known evidence IDs and an exact quote from a
  retrieved record. This verifies record linkage, not original-document text
  or the truth of the inference. Unsupported or uncertain findings are withheld.
- A malformed/incomplete critic, transport failure or budget failure publishes
  no model findings. Evidence and an explicit failure state remain available.
- React renders generated content as text, not trusted HTML. Existing session,
  CSRF/origin checks, durable ownership, concurrency quotas and idempotency apply.

Budgets: at most four questions, five read-only tools, three model calls, six
findings, eighty evidence records and 48 KB corpus. Each model input is capped
at 64 KB, response at 64 KB, completion at 2,400 tokens and request at 30 seconds.
The model phase has a 100-second cancellation signal. No paid retry loops.
The existing finance read and optional issuer read add their own bounded time;
this fits within the existing 180-second job lease. No live latency/cost claim
is made. Maximum requested completion allowance is 7,200 tokens; input tokens
and monetary cost depend on model selection and actual context.

Trace records stage, elapsed time, counts and provider token usage where present.
It does not store raw provider errors or private reasoning. Existing output
storage contains public evidence and the user's brief; do not add confidential
uploads without dedicated access control, retention and model data policies.

## Rollout, verification and remaining work

`RESEARCH_MANAGER_ENABLED=false` by default. Enable only together with
`RESEARCH_MODEL_ENABLED=true`, a configured model/key and validated source reads.
When disabled, the Hub returns an evidence/gap pack without a paid model call.
Rollback: disable the manager flag; existing screening and legacy research remain.
No database migration or new service is needed. This change does not deploy itself.

Tests cover invalid briefs, forbidden tools, prompt-injected tool arguments,
wrong issuers/periods, null/conflicted evidence, duplicate/unknown/non-exact
citations, numeric narrative restrictions, disabled/no-evidence zero-call paths,
three-stage ordering, critic rejection/incompleteness, provider failures, transport
limits and direct job routing. Browser tests exercise Hub submission and report
rendering at mobile and desktop sizes with mocked public evidence. Fixtures with
synthetic financial numbers test controls only, not financial correctness.

Local verification on 2026-10-11: 110 Vitest tests, TypeScript, worker build and
production Next.js build pass. Playwright passes all three scenarios in both
development and production, including mobile/desktop Hub submission. ESLint has
zero errors and one pre-existing apostrophe warning in the workbench. No paid
model call, production deployment or real-source quality benchmark was run.

Before production enablement: benchmark single-call versus manager on reviewed
SEC/CVM cases (English/Portuguese; annual/interim; amendments; missing evidence;
prompt-injected documents). Measure claim-level support, citation precision,
abstention on missing evidence, period/issuer correctness, cost and p95 latency.
Require no cross-issuer/cross-period leakage and no fabricated citations or
numbers in the approved evaluation set. Record reviewer disagreements; preserve
human approval rather than treating a passed synthetic test as source acceptance.

Next acquisition slice: a GPI-owned company/year/document manifest, content
hashes, immutable source metadata and authorized ingestion into FilingLens.
Gap resolution should be a separate constrained acquisition workflow, with
official-source allowlists, rate limits, SSRF defenses, MIME/size validation,
deduplication and explicit unresolved states. Add full-text retrieval only after
that evidence contract and a real-document evaluation set exist.
