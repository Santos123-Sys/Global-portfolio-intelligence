import type { MarketBrief } from '@portfolio-intelligence/agentic-contract';

function Claims({ title, claims, urls }: { title: string; claims: Array<{ statement: string; evidenceRefs: string[]; confidence: string }>; urls: Map<string, string> }) {
  return <section>
    <h4>{title}</h4>
    {claims.length ? <ul>{claims.map((claim, index) => <li key={`${title}:${index}`}>
      {claim.statement} <span className="note">· {claim.confidence} confidence · </span>
      {claim.evidenceRefs.map((ref, refIndex) => <span key={ref}>{refIndex ? ' ' : ''}<a className="text-link" href={urls.get(ref)} target="_blank" rel="noreferrer">Source {refIndex + 1}</a></span>)}
    </li>)}</ul> : <p className="note">No sufficiently sourced findings. Check the information gaps.</p>}
  </section>;
}

export function MarketBriefReview({ brief, busy, onApprove }: { brief: MarketBrief; busy: boolean; onApprove: () => void }) {
  const urls = new Map(brief.evidenceRegister.map((item) => [item.id, item.url]));
  return <section className="market-brief-review" aria-label="Top-down market research brief">
    <div className="section-heading"><div><p className="analysis-eyebrow">TDMRA · evidence review</p><h3>Market research brief</h3></div>
      <span className={`badge ${brief.confidence === 'sufficient' ? 'ok' : 'watch'}`}>{brief.confidence} evidence</span>
    </div>
    <p>{brief.executiveSummary}</p>
    <dl className="market-brief-definition">
      <div><dt>Market</dt><dd>{brief.marketDefinition.industry} · {brief.marketDefinition.productScope}</dd></div>
      <div><dt>Geography / period</dt><dd>{brief.marketDefinition.geography} · {brief.marketDefinition.period}</dd></div>
    </dl>
    {brief.marketDefinition.assumptions.length > 0 && <p className="note"><strong>Scope assumptions:</strong> {brief.marketDefinition.assumptions.join(' · ')}</p>}
    <div className="market-brief-sections">
      {brief.marketSizing.map((item, index) => <section key={`${item.measure}:${index}`}>
        <h4>{item.measure}: {item.value}</h4><p>{item.methodology}</p>
        <p>{item.claim.statement} {item.claim.evidenceRefs.map((ref, refIndex) => <span key={ref}>{refIndex ? ' ' : ''}<a className="text-link" href={urls.get(ref)} target="_blank" rel="noreferrer">Source {refIndex + 1}</a></span>)}</p>
      </section>)}
      <Claims title="Macro and policy" claims={brief.macroAndPolicy} urls={urls} />
      <Claims title="Value chain" claims={brief.valueChain} urls={urls} />
      <Claims title="Demand and customers" claims={brief.demandAndCustomers} urls={urls} />
      <Claims title="Go-to-market and channels" claims={brief.goToMarketAndChannels} urls={urls} />
      <Claims title="Competitive landscape" claims={brief.competitiveLandscape} urls={urls} />
      <Claims title="Company positioning" claims={brief.companyPositioning} urls={urls} />
      <Claims title="Thesis fit" claims={[...brief.thesisFit.alignment, ...brief.thesisFit.tensions]} urls={urls} />
    </div>
    {brief.monitoringQuestions.length > 0 && <p><strong>Questions for deeper analysis:</strong> {brief.monitoringQuestions.join(' · ')}</p>}
    {brief.informationGaps.length > 0 && <div className="caveat"><strong>Information gaps:</strong><ul>{brief.informationGaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul></div>}
    <details><summary>Evidence register ({brief.evidenceRegister.length})</summary>
      <ul>{brief.evidenceRegister.map((item) => <li key={item.id}><a className="text-link" href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
        <p className="note">{item.publisher} · {item.sourceKind.replaceAll('_', ' ')} · retrieved {new Date(item.retrievedAt).toLocaleString()}{item.publishedAt ? ` · published ${item.publishedAt}` : ''}</p>
        <p>{item.excerpt}</p></li>)}</ul>
    </details>
    <p className="note">Review this market evidence before continuing. DCF, peer valuation, and portfolio weights remain separate downstream calculations.</p>
    <button className="action-button" type="button" onClick={onApprove} disabled={busy}>Approve market brief and start financial analysis</button>
  </section>;
}
