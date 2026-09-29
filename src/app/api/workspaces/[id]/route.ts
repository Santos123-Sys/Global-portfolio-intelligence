import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { ingestionJobs } from '@/lib/db/workflow-schema';
import { assertWorkspaceAccess, queueIngestionJob } from '@/lib/document-intelligence/workspace-manager';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: Context) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const { id } = await context.params;
  const workspace = await assertWorkspaceAccess(id, session.auth.userId);
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  const jobs = await db.select().from(ingestionJobs).where(and(eq(ingestionJobs.workspaceId, id), eq(ingestionJobs.ownerId, workspace.ownerId), eq(ingestionJobs.securityId, workspace.securityId))).orderBy(desc(ingestionJobs.startedAt)).limit(10);
  return NextResponse.json({ workspace, jobs });
}

export async function POST(req: Request, context: Context) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  assertSameOrigin(req);
  const { id } = await context.params;
  const workspace = await assertWorkspaceAccess(id, session.auth.userId);
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  const job = await queueIngestionJob({ workspaceId: id, securityId: workspace.securityId, ownerId: workspace.ownerId, jobType: 'incremental', triggeredBy: 'manual' });
  return NextResponse.json({ job }, { status: 202 });
}
