import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { aiAnalyses, securities, thesisVersions } from '@/lib/db/schema';
import { requirePageSession } from '@/lib/page-auth';

export const dynamic = 'force-dynamic';

export default async function AIInsightsPage() {
  const session = await requirePageSession();
  const rows = await db
    .select({
      id: aiAnalyses.id,
      ticker: securities.ticker,
      companyName: securities.companyName,
      role: aiAnalyses.portfolioRole,
      score: aiAnalyses.investmentScore,
      confidence: aiAnalyses.confidenceScore,
      summary: aiAnalyses.fundamentalSummary,
      thesis: aiAnalyses.investmentThesis,
      catalysts: aiAnalyses.keyCatalysts,
      risks: aiAnalyses.keyRisks,
      breakers: aiAnalyses.thesisBreakers,
      groundedIn: aiAnalyses.groundedIn,
      thesisVersion: thesisVersions.versionNumber,
      timestamp: aiAnalyses.analysisTimestamp,
    })
    .from(aiAnalyses)
    .innerJoin(securities, eq(aiAnalyses.securityId, securities.id))
    .innerJoin(thesisVersions, eq(aiAnalyses.thesisVersionId, thesisVersions.id))
    .where(and(
      eq(aiAnalyses.ownerId, session.userId),
      isNull(thesisVersions.excludedAt)
    ))
    .orderBy(desc(aiAnalyses.analysisTimestamp));

  return (
    <main>
      <section className="dashboard-hero animate-fade-in">
        <h1 className="text-glow">AI Insights</h1>
        <p className="hero-lead">AI interpretations are stored separately from deterministic KPI records and must expose their grounding.</p>
        <div className="dashboard-hero-actions" aria-label="Insight summary">
          <div className="stat-chip animate-scale-in delay-100"><span>Insights</span><span className="stat-value">{rows.length}</span></div>
          <div className="stat-chip animate-scale-in delay-200"><span>Thesis versions</span><span className="stat-value">{new Set(rows.map((row) => row.thesisVersion)).size}</span></div>
          <div className="stat-chip animate-scale-in delay-300"><span>Grounded</span><span className="stat-value">{rows.filter((row) => (row.groundedIn?.length ?? 0) > 0).length}</span></div>
        </div>
      </section>
      {rows.length === 0 ? <div className="card glow-card"><p className="note">No AI insights stored.</p></div> : (
        <div className="grid">
          {rows.map((r) => (
            <article className="card glow-card" key={r.id}>
              <h2>{r.companyName} · {r.ticker}</h2>
              <p className="note">Thesis v{r.thesisVersion} · {r.role} · Score {r.score}/100 · Confidence {(r.confidence * 100).toFixed(0)}%</p>
              <p>{r.summary}</p>
              <p>{r.thesis}</p>
              <p className="note">Catalysts: {(r.catalysts ?? []).join(' · ') || '—'}</p>
              <p className="note">Risks: {(r.risks ?? []).join(' · ') || '—'}</p>
              <p className="caveat">Thesis breakers: {(r.breakers ?? []).join(' · ') || '—'}</p>
              <p className="note">Grounded in: {(r.groundedIn ?? []).join(', ') || 'INVALID — no grounding'}</p>
              <p className="note">{r.timestamp.toISOString()}</p>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
