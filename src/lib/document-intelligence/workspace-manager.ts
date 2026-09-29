import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { portfolios, positions } from '../db/schema';
import { companyWorkspaces, ingestionJobs } from '../db/workflow-schema';

export interface ProvisionParams { securityId: string; ownerId: string; ticker: string; exchange: string; country?: string | null }
type WorkspaceExecutor = Pick<typeof db, 'insert' | 'select'>;

export async function queueIngestionJob(params: { workspaceId: string; securityId: string; ownerId: string; jobType: string; triggeredBy: string }) {
  const [job] = await db.insert(ingestionJobs).values({ ...params, logJson: [`Queued by ${params.triggeredBy} at ${new Date().toISOString()}`] }).returning();
  return job;
}

async function provisionWith(executor: WorkspaceExecutor, params: ProvisionParams) {
    const [workspace] = await executor.insert(companyWorkspaces).values(params).onConflictDoUpdate({
      target: [companyWorkspaces.securityId, companyWorkspaces.ownerId],
      set: { ticker: params.ticker, exchange: params.exchange, country: params.country ?? null, status: 'active' },
    }).returning();
    const [queued] = await executor.select({ id: ingestionJobs.id }).from(ingestionJobs).where(and(
      eq(ingestionJobs.workspaceId, workspace.id), eq(ingestionJobs.jobType, 'full_ingestion'),
      sql`${ingestionJobs.status} in ('queued', 'running', 'completed')`
    )).limit(1);
    if (!queued) await executor.insert(ingestionJobs).values({ workspaceId: workspace.id, securityId: params.securityId, ownerId: params.ownerId, jobType: 'full_ingestion', triggeredBy: 'position_added', logJson: ['Initial ingestion queued by position_added'] });
    return workspace;
}

export async function provisionCompanyWorkspace(params: ProvisionParams, executor?: WorkspaceExecutor) {
  if (executor) return provisionWith(executor, params);
  return db.transaction((tx) => provisionWith(tx, params));
}

export async function assertWorkspaceAccess(workspaceId: string, ownerId: string) {
  const [workspace] = await db.select().from(companyWorkspaces).where(and(eq(companyWorkspaces.id, workspaceId), eq(companyWorkspaces.ownerId, ownerId))).limit(1);
  if (!workspace) return null;
  const [holding] = await db.select({ id: positions.id }).from(positions).innerJoin(portfolios, eq(positions.portfolioId, portfolios.id)).where(and(eq(positions.securityId, workspace.securityId), eq(portfolios.ownerId, ownerId))).limit(1);
  return holding ? workspace : null;
}
