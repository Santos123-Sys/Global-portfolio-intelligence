import Link from 'next/link';
import { count, desc } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import ExistingHoldingsPanel from '@/components/research-operations/existing-holdings-panel';
import ActivityPanel from '@/components/research-operations/activity-panel';
import DocumentIntelligencePanel from '@/components/research-operations/document-intelligence-panel';
import { db } from '@/lib/db';
import { companyWorkspaces, ingestionJobs, intelligenceDocuments } from '@/lib/db/workflow-schema';
import { requirePageSession } from '@/lib/page-auth';
import styles from './research-operations.module.css';

export const dynamic = 'force-dynamic';
type OperationsView = 'holdings' | 'activity' | 'documents';

export default async function ResearchOperationsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [session, params] = await Promise.all([requirePageSession(), searchParams]);
  const allowedViews: OperationsView[] = session.isPlatformAdmin ? ['holdings', 'activity', 'documents'] : ['holdings'];
  const requested = params.view as OperationsView | undefined;
  if (requested && !allowedViews.includes(requested)) notFound();
  const view = requested ?? 'holdings';
  const tabs = [{ id: 'holdings' as const, label: 'Existing-holdings analysis' }, ...(session.isPlatformAdmin ? [{ id: 'activity' as const, label: 'Admin activity' }, { id: 'documents' as const, label: 'Document intelligence' }] : [])];
  let panel: React.ReactNode;
  if (view === 'holdings') panel = <ExistingHoldingsPanel />;
  else if (view === 'activity') panel = <ActivityPanel />;
  else {
    const [workspaceCounts, documentCounts, recentJobs] = await Promise.all([
      db.select({ status: companyWorkspaces.status, total: count() }).from(companyWorkspaces).groupBy(companyWorkspaces.status),
      db.select({ status: intelligenceDocuments.processingStatus, total: count() }).from(intelligenceDocuments).groupBy(intelligenceDocuments.processingStatus),
      db.select().from(ingestionJobs).orderBy(desc(ingestionJobs.startedAt)).limit(50),
    ]);
    panel = <DocumentIntelligencePanel workspaceCounts={workspaceCounts} documentCounts={documentCounts} recentJobs={recentJobs} />;
  }
  return <main><section className="dashboard-hero"><p className="eyebrow">Research operations</p><h1>Research Operations</h1><p className="hero-lead">Run existing-holdings analysis, review operational history, and monitor document ingestion from one workspace.</p></section>
    <nav className={styles.tabs} aria-label="Research operations sections">{tabs.map((tab) => <Link key={tab.id} href={`/research-operations?view=${tab.id}`} aria-current={view === tab.id ? 'page' : undefined} className={`${styles.tab}${view === tab.id ? ` ${styles.active}` : ''}`}>{tab.label}</Link>)}</nav>
    <section aria-label={tabs.find((tab) => tab.id === view)?.label}>{panel}</section>
  </main>;
}
