import { and, desc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { WorkspaceNav } from '@/components/document-intelligence/workspace-nav';
import { RefreshWorkspace } from '@/components/document-intelligence/refresh-workspace';
import { IngestionStatus } from '@/components/document-intelligence/ingestion-status';
import { db } from '@/lib/db';
import { ingestionJobs } from '@/lib/db/workflow-schema';
import { assertWorkspaceAccess } from '@/lib/document-intelligence/workspace-manager';
import { requirePageSession } from '@/lib/page-auth';

export const dynamic = 'force-dynamic';
export default async function WorkspaceOverview({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageSession(); const { id } = await params; const workspace = await assertWorkspaceAccess(id, session.userId); if (!workspace) notFound();
  const jobs = await db.select().from(ingestionJobs).where(and(eq(ingestionJobs.workspaceId, id), eq(ingestionJobs.ownerId, workspace.ownerId), eq(ingestionJobs.securityId, workspace.securityId))).orderBy(desc(ingestionJobs.startedAt)).limit(10);
  return <main><section className="dashboard-hero"><p className="eyebrow">Company workspace</p><h1>{workspace.ticker} document intelligence</h1><p className="hero-lead">Primary filings, financial reports, material facts, and adapted news in one holding-scoped research index.</p><RefreshWorkspace workspaceId={id} /></section><WorkspaceNav workspaceId={id} active="overview" /><section className="metrics-grid"><div className="card"><span className="note">Documents</span><h2>{workspace.documentCount}</h2></div><div className="card"><span className="note">Semantic chunks</span><h2>{workspace.chunkCount}</h2></div><div className="card"><span className="note">Grounded chat</span><h2>{workspace.ragEnabled ? 'Ready' : 'Waiting'}</h2></div></section><section className="card table-scroll"><h2>Ingestion activity</h2><table><thead><tr><th>Job</th><th>Started</th><th>Documents</th><th>Status</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td>{job.jobType.replaceAll('_', ' ')}</td><td>{job.startedAt?.toLocaleString() ?? 'Queued'}</td><td>{job.documentsIngested ?? 0} / {job.documentsDiscovered ?? 0}</td><td><IngestionStatus status={job.status} error={job.errorMessage} /></td></tr>)}</tbody></table>{!jobs.length && <p className="note">Initial ingestion has not started.</p>}</section></main>;
}
