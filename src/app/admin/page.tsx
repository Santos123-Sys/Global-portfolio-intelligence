import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buildAdminDashboard } from '@/lib/admin-dashboard';
import { requirePageSession } from '@/lib/page-auth';

export const dynamic = 'force-dynamic';

const ADMIN_TOOLS = [
  { href: '/research-operations', title: 'Research Operations', detail: 'Existing-holdings analysis, activity logs, and document intelligence.' },
  { href: '/agent-settings', title: 'Agent settings', detail: 'Versioned prompts, tool access, and deterministic engine policies.' },
  { href: '/account/security', title: 'Account security', detail: 'Multi-factor authentication, recovery codes, and session security.' },
] as const;

export default async function AdminPage() {
  const session = await requirePageSession();
  if (!session.isPlatformAdmin) notFound();
  const data = await buildAdminDashboard(session.userId);

  return <main>
    <section className="dashboard-hero">
      <p className="eyebrow">Administration</p>
      <h1>Admin panel</h1>
      <p className="hero-lead">Operational controls, account protection, provider diagnostics, and immutable investment history in one administrative workspace.</p>
    </section>

    <nav className="admin-section-nav" aria-label="Admin panel sections">
      <a href="#admin-tools">Admin tools</a>
      <a href="#provider-health">Provider health</a>
      <a href="#thesis-decision-history">Thesis and decision history</a>
    </nav>

    <section id="admin-tools" className="admin-tool-grid" aria-label="Admin tools">
      {ADMIN_TOOLS.map((tool) => <Link className="card admin-tool-card" href={tool.href} key={tool.href}>
        <h2>{tool.title}</h2>
        <p>{tool.detail}</p>
        <span className="text-link">Open {tool.title} →</span>
      </Link>)}
    </section>

    <section className="card governance-section" id="provider-health">
      <h2>Provider health</h2>
      <p className="note">The latest 250 provider calls are aggregated for troubleshooting. Credentials and request payloads are never exposed.</p>
      {data.providerHealth.length === 0 ? <p className="note">No provider calls have been recorded.</p> : <div className="table-scroll"><table><thead><tr><th>Provider</th><th>Endpoint</th><th>OK</th><th>Errors</th><th>Plan limits</th><th>Rate limits</th><th>Last call</th></tr></thead><tbody>{data.providerHealth.map((item) => <tr key={`${item.provider}:${item.endpoint}`}><td>{item.provider}</td><td><code>{item.endpoint}</code></td><td>{item.ok}</td><td>{item.errors}</td><td>{item.planLimits}</td><td>{item.rateLimited}</td><td>{new Date(item.lastCalledAt).toLocaleString()}</td></tr>)}</tbody></table></div>}
    </section>

    <section className="card governance-section" id="thesis-decision-history">
      <h2>Thesis and decision history</h2>
      <p className="note">History remains append-only and owner-scoped. These administrative records are separated from active investment controls.</p>
      <div className="governance-versioning">
        <div><strong>Thesis history</strong>{data.thesisVersions.length ? data.thesisVersions.map((thesis) => <p key={thesis.id}>Version {thesis.version} · effective {new Date(thesis.effectiveDate).toLocaleDateString()}{thesis.excludedAt ? ' · excluded' : thesis.supersededAt ? ' · superseded' : ' · active'}</p>) : <p>No thesis versions recorded.</p>}</div>
        <div><strong>Recent immutable decisions</strong>{data.decisions.length ? data.decisions.map((decision) => <p key={decision.id}>{new Date(decision.date).toLocaleDateString()} · {decision.decision} · {decision.title}{decision.hasThesisSnapshot ? ' · thesis snapshot retained' : ''}</p>) : <p>No decisions recorded.</p>}<Link className="text-link" href="/decisions">Search full decision log →</Link></div>
      </div>
      <Link className="text-link" href="/investment-thesis#portfolio-guardrails">Review optional thesis guardrails →</Link>
    </section>
  </main>;
}
