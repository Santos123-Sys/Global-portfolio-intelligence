import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Research workspace · Global Portfolio Intelligence' };

const workspaces = [
  { number: '01', title: 'Define your thesis', description: 'Set your objectives, markets and exclusions. Confirm the criteria before starting research.', href: '/investment-thesis', action: 'Open thesis', detail: 'Your investment framework' },
  { number: '02', title: 'Discover and evaluate', description: 'Find candidates, review evidence and risks, then explore valuations in one research workspace.', href: '/ai-stock-discovery', action: 'Open discovery', detail: 'Research → analysis → valuation' },
  { number: '03', title: 'Monitor your portfolio', description: 'Manage your holdings and review allocation, concentration and portfolio risk.', href: '/positions', action: 'Open positions', detail: 'Holdings and ongoing oversight' },
] as const;

export default function HowItWorksPage() {
  return <main className="workspace-home">
    <section aria-labelledby="workspace-actions">
      <div className="workspace-section-heading"><h2 id="workspace-actions">Choose your next step</h2><span className="note">Start with a thesis if you’re new here</span></div>
      <div className="workspace-action-grid">{workspaces.map((item) => <article className="workspace-action-card" key={item.number}>
        <span className="workspace-step" aria-hidden="true">{item.number}</span><p className="analysis-eyebrow">{item.detail}</p><h3>{item.title}</h3><p>{item.description}</p><Link className="action-button inline-action" href={item.href}>{item.action} <span aria-hidden="true">→</span></Link>
      </article>)}</div>
    </section>
    <section className="card example-entry"><p className="analysis-eyebrow">Explore before creating your own portfolio</p><h2>Try a populated example</h2><p>Walk through a fictional six-company portfolio: review sample research, inspect financial calculations and compare computed allocation methods. The example is isolated from live portfolios.</p><Link className="action-button inline-action" href="/example-portfolio">Explore example portfolio →</Link></section>
    <div className="workspace-help-grid">
      <section className="card"><h2>Make the workspace yours</h2><p>Create a portfolio or update its mandate and base currency before adding holdings.</p><Link className="text-link" href="/portfolio-setup">Manage portfolios</Link></section>
      <details className="card workspace-guide"><summary>How the research workflow works</summary><ol>
        <li><strong>Define:</strong> Upload or create your thesis and confirm its extracted criteria.</li>
        <li><strong>Discover:</strong> Screen a sourced universe against the confirmed mandate.</li>
        <li><strong>Analyze:</strong> Approve candidates for company research, source review and price-risk analysis.</li>
        <li><strong>Value:</strong> Review primary-source financials, DCF assumptions and comparable companies in the candidate workspace.</li>
        <li><strong>Monitor:</strong> Add holdings after your decision and review portfolio-level risk when enough history exists.</li>
      </ol><p className="note">Approving research does not create a holding. Missing evidence stays visible throughout the workflow.</p></details>
    </div>
  </main>;
}
