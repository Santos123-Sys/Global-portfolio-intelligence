import { NextResponse } from 'next/server';
import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from '@/lib/db';
import { externalAgenticRuns } from '@/lib/db/workflow-schema';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { fetchExternalAgenticRun } from '@/lib/integrations/agentic-client';
import { getAgenticReadiness } from '@/lib/integrations/grounding-builder';

export const runtime = 'nodejs';

const retiredResponse = () => NextResponse.json({
  error: 'legacy_analysis_orchestration_retired',
  message: 'New security research is executed by the canonical Research Director runtime. Start or retry the analysis from Research Workspace.',
  canonicalPath: '/api/agents/analyze',
}, { status: 410 });

/** Historical external runs remain readable so existing reports are not lost. */
export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const externalRunId = new URL(req.url).searchParams.get('externalRunId');

  if (externalRunId) {
    const [local] = await db.select().from(externalAgenticRuns).where(and(
      eq(externalAgenticRuns.externalRunId, externalRunId),
      eq(externalAgenticRuns.ownerId, session.auth.userId)
    )).limit(1);
    if (!local) return NextResponse.json({ error: 'External run not found' }, { status: 404 });

    try {
      const remote = await fetchExternalAgenticRun(externalRunId);
      const [updated] = await db.update(externalAgenticRuns).set({
        status: local.status === 'imported' ? 'imported' : remote.status,
        errorMessage: remote.errorMessage,
        completedAt: remote.status === 'completed' || remote.status === 'failed' ? new Date() : local.completedAt,
        reportPdfUrl: remote.reportPdfUrl ?? local.reportPdfUrl,
      }).where(eq(externalAgenticRuns.id, local.id)).returning();
      return NextResponse.json({ run: updated, remote, legacy: true });
    } catch (error) {
      return NextResponse.json({ run: local, remoteError: (error as Error).message, legacy: true });
    }
  }

  const listRuns = () => db.select({
    id: externalAgenticRuns.id,
    externalRunId: externalAgenticRuns.externalRunId,
    status: externalAgenticRuns.status,
    thesisVersion: externalAgenticRuns.thesisVersion,
    requestedAt: externalAgenticRuns.requestedAt,
    completedAt: externalAgenticRuns.completedAt,
    importedAt: externalAgenticRuns.importedAt,
    reportPdfUrl: externalAgenticRuns.reportPdfUrl,
    errorMessage: externalAgenticRuns.errorMessage,
  }).from(externalAgenticRuns)
    .where(eq(externalAgenticRuns.ownerId, session.auth.userId))
    .orderBy(desc(externalAgenticRuns.requestedAt)).limit(50);

  const [initialRuns, readiness] = await Promise.all([listRuns(), getAgenticReadiness(session.auth.userId)]);
  let runs = initialRuns;
  const active = runs.filter((run) => run.status === 'queued' || run.status === 'running');
  if (active.length) {
    await Promise.all(active.map(async (run) => {
      try {
        const remote = await fetchExternalAgenticRun(run.externalRunId);
        await db.update(externalAgenticRuns).set({
          status: remote.status,
          errorMessage: remote.errorMessage,
          reportPdfUrl: remote.reportPdfUrl ?? run.reportPdfUrl,
          completedAt: remote.status === 'completed' || remote.status === 'failed' ? new Date() : run.completedAt,
        }).where(and(eq(externalAgenticRuns.id, run.id), ne(externalAgenticRuns.status, 'imported')));
      } catch { /* historical status remains durable when the old service is unavailable */ }
    }));
    runs = await listRuns();
  }

  return NextResponse.json({
    runs: runs.map((run) => ({
      externalRunId: run.externalRunId,
      status: run.status,
      thesisVersion: run.thesisVersion,
      requestedAt: run.requestedAt,
      completedAt: run.completedAt,
      importedAt: run.importedAt,
      errorMessage: run.errorMessage,
      reportUrl: run.reportPdfUrl || run.status === 'completed' || run.status === 'imported'
        ? `/api/integrations/agentic/reports?externalRunId=${encodeURIComponent(run.externalRunId)}` : null,
      legacy: true,
    })),
    readiness,
    orchestration: 'research_director',
    legacyAnalysisWritesEnabled: false,
  });
}

/** Legacy retries are intentionally disabled; reanalysis creates a new canonical session. */
export async function PATCH(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  return retiredResponse();
}

/** Legacy analysis creation is intentionally disabled. */
export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  return retiredResponse();
}
