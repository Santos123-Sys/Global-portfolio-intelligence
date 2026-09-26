# Discovery workflow review

## Research basis and decisions

- OpenFIGI API documentation: https://www.openfigi.com/api/documentation
  Exchange/MIC and instrument identifiers are explicit mapping inputs. Keep exact exchange/ticker identities and optional FIGI/ISIN enrichment; do not ask a model to invent identities or collapse multiple listings into an issuer.
- Finnhub stock symbols: https://finnhub.io/docs/api/stock-symbols
  This endpoint provides a listing universe. Its returned order does not establish thesis relevance. The application must disclose its own cap and selection method.
- CFA Institute Standard V(A), Diligence and Reasonable Basis: https://www.cfainstitute.org/standards/professionals/code-ethics-standards/standards-of-practice-v-a
  Appropriate research is needed to support investment analysis. Counting retrieved URLs and identity fields cannot establish a sufficient investment basis. This is design inspiration, not a claim that software checks establish professional compliance.

## Architecture retained

Confirmed, version-pinned thesis → provider and dated seed universe → qualitative research → validated per-market shortlist → human decision → separate financial research and valuation.

Keep provider identities, cited provenance, schema and semantic validation, currency/mandate boundaries, candidate caps per portfolio, independent portfolio outcomes, audit history and the human decision journal. Discovery never creates holdings or unlocks DCF by itself.

## Implemented improvements

### Inputs and coverage

Finnhub records are deduplicated by exchange/ticker before applying the cap. Records carry the eligible unique count from that response, selected count, truncation flag, unranked selection label and explicit listing country. These counts are not total exchange coverage. Provider order remains unchanged; no ranking or market-cap data is invented. Cached records preserve the metadata when present. Legacy caches without metadata remain a limitation until refreshed.

The UI discloses bounded/unranked coverage even when candidates were found. Curated seed additions can broaden the supplied set, but neither the seed nor the provider slice implies an exhaustive or unbiased market screen. Listing country, issuer domicile and cited revenue geography remain distinct concepts.

### Research reliability and logic

Research remains sequential to preserve the existing search request rate. A security-level failure no longer aborts every market before analysis begins. The service records a safe failure identity, retains other successful results, sends the missing-evidence state to the model, and adds an unavoidable information gap to any returned candidate whose research failed. Raw provider errors are not persisted.

A market where all security lookups failed skips the model and is marked failed. A partial market returning zero candidates is also failed/incomplete, rather than a no-match conclusion. A partial market with candidates retains them and discloses its retrieval limitations. If all portfolios fail, the existing overall failure behavior remains. An empty successful response and disabled web research are not transport failures; they still cannot substantiate claims. The model instructions explicitly distinguish unknown evidence from matching or violating a criterion.

### Outputs

The discovery evidence panel is an inventory: distinct URL count, grounding-field count, recorded gaps and conflicts, and presence of a market price. It no longer awards a sufficient-evidence badge from two URLs and two fields. References may describe identity or retrieval metadata, not business facts. These UI/API field names change together; persisted candidate and agent contracts remain unchanged.

Run-level limitations are expandable in the review UI, including retrieval failures. Human approval continues to authorize further research, not purchase or portfolio inclusion. Price availability alone does not establish freshness or suitability.

## Not adopted and remaining gaps

- No extra agents or confidence-based approval: neither fixes missing evidence or universe selection bias.
- No fabricated liquidity/market-cap ranking. Broad-market recall requires a documented selection policy and eligible universe with verified attributes, plus evaluation across countries and sectors.
- No automatic rejection of every candidate with a conflict: the current contract does not distinguish a hard prohibition from a soft preference. The extraction/criterion contract needs typed hard constraints before deterministic exclusion can replace the existing model instruction and human review.
- No claim-level verification score. A future criterion-evidence matrix should link each criterion to dated source excerpts and an explicit met/violated/unknown result; URL presence is not that matrix.
- No provider-wide circuit breaker in this change. Sequential per-security retries can still make an outage slow; a bounded job budget and provider error taxonomy deserve a separate reliability change.
- Current roles and currency-based market routing remain limited to configured Swiss and Brazilian portfolios. Broader routing needs explicit allowed markets rather than assuming currency is geography.

## Verification

Behavioral tests cover duplicate/filter/cap metadata, evidence inventory semantics, partial research gaps, incomplete zero-result handling, complete research outages and independent market outcomes. Browser tests exercise the evidence labels and limitations alongside the existing approval-to-report workflow. Live paid providers and production persistence are outside local verification.
