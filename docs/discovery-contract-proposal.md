# Discovery contract proposal — 2026-09-27

Implement an additive revision to the existing agentic contract, retaining historical request/result compatibility. Dashboard owns portfolio/holding/review state; the service owns research and model calls; neither writes the other's database.

- Optional `knownSecurities` request snapshot: portfolio, listing, canonical issuer key when available, reason and thesis version. Current holdings and active candidates suppress repeat work within their portfolio; rejections suppress only the same approved thesis version.
- Shared deterministic screening returns individual PASS/FAIL/UNKNOWN/NOT_APPLICABLE rule results, source references and thesis paths. No soft preference or macro assumption is an eligibility gate. Reporting currency is independent from listing/trading currency.
- Canonical issuer deduplication uses explicit LEI/issuer ID, falling back to exact listing identity, never fuzzy company names. Choose the first eligible listing with primary listings preferred; preserve other listings in the audit.
- Optional service-owned `screeningAudit` in results records each considered listing and stage counts. Optional candidate `discoveryContext` supplies thesis version, eligibility, issuer identity, discovery channel and dated evidence to review and Analysis. Models cannot author these fields.
- Filter and deduplicate before web calls. Record research errors and missing evidence separately from eligibility. Existing validated per-portfolio model calls remain.
- Persist additions in existing JSON snapshots: no relational migration required. Roll out shared contract and service before dashboard; older results remain readable. New requests containing knownSecurities require the updated service.

Retain current provider adapters, jobs, owner boundaries, human approval and limited-data Analysis safeguards. This patch does not invent coverage, scores, financial thresholds or source publication dates. Broader market expansion, metric adapters, durable remote dispatch and claim-level primary-source verification require subsequent work detailed in the audit.
