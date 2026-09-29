import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../db';
import { companyWorkspaces, ingestionJobs, intelligenceDocuments } from '../db/workflow-schema';
import { withLock } from '../services/lock';
import { runIngestionJob } from './ingestion-pipeline';
import { SqliteNewsSource, syncNewsArticles } from './news-adapter';

export const JOB_TYPES = ['full_ingestion', 'incremental', 'material_disclosure', 'news_sync', 'retry_failed', 'index_maintenance'] as const;
export type JobType = typeof JOB_TYPES[number];

export async function scheduleWorkspaceJobs(jobType: JobType) {
  if (jobType === 'index_maintenance') { await db.execute(sql`VACUUM ANALYZE document_embeddings`); const rebuilt = new Date().getUTCDate() <= 7; if (rebuilt) await db.execute(sql`REINDEX INDEX document_embeddings_hnsw_idx`); return { scheduled: 0, maintained: true, rebuilt }; }
  const workspaces = await db.select().from(companyWorkspaces).where(eq(companyWorkspaces.status, 'active'));
  if (jobType === 'retry_failed') {
    const retryable = await db.select({ workspaceId: intelligenceDocuments.workspaceId }).from(intelligenceDocuments).where(and(eq(intelligenceDocuments.processingStatus, 'failed'), lt(intelligenceDocuments.retryCount, 3)));
    const ids = new Set(retryable.map((row) => row.workspaceId)); let scheduled = 0;
    for (const workspace of workspaces.filter((row) => ids.has(row.id))) { const [active] = await db.select({ id: ingestionJobs.id }).from(ingestionJobs).where(and(eq(ingestionJobs.workspaceId, workspace.id), eq(ingestionJobs.ownerId, workspace.ownerId), eq(ingestionJobs.securityId, workspace.securityId), eq(ingestionJobs.jobType, 'retry_failed'), inArray(ingestionJobs.status, ['queued', 'running']))).limit(1); if (!active) { await db.insert(ingestionJobs).values({ workspaceId: workspace.id, securityId: workspace.securityId, ownerId: workspace.ownerId, jobType: 'retry_failed', triggeredBy: 'retry_failed', logJson: ['Retry ingestion queued'] }); scheduled++; } }
    return { scheduled };
  }
  if (jobType === 'news_sync') {
    const path = process.env.NEWS_SCRAPER_DB_PATH; if (!path) return { scheduled: 0, skipped: 'NEWS_SCRAPER_DB_PATH is not configured' };
    let synced = 0; const source = new SqliteNewsSource(path); for (const workspace of workspaces) synced += await syncNewsArticles(workspace.id, workspace.ownerId, workspace.securityId, source); return { scheduled: synced };
  }
  let scheduled = 0;
  for (const workspace of workspaces) { const [active] = await db.select({ id: ingestionJobs.id }).from(ingestionJobs).where(and(eq(ingestionJobs.workspaceId, workspace.id), inArray(ingestionJobs.status, ['queued', 'running']), eq(ingestionJobs.jobType, jobType))).limit(1); if (!active) { await db.insert(ingestionJobs).values({ workspaceId: workspace.id, securityId: workspace.securityId, ownerId: workspace.ownerId, jobType, triggeredBy: 'schedule', logJson: [`${jobType} scheduled`] }); scheduled++; } }
  return { scheduled };
}

export async function processQueuedJobs(limit = 2) {
  const jobs = await db.select().from(ingestionJobs).where(eq(ingestionJobs.status, 'queued')).limit(Math.max(1, Math.min(limit, 5)));
  const outcomes = [];
  for (const job of jobs) outcomes.push(await withLock(`document-ingestion:${job.workspaceId}`, () => runIngestionJob(job.id, job.ownerId, job.securityId), 900));
  return outcomes;
}
