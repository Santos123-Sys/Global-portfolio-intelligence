import { NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { ragConversations, ragMessages } from '@/lib/db/workflow-schema';
import { assertWorkspaceAccess } from '@/lib/document-intelligence/workspace-manager';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: Context) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const { id } = await context.params;
  const workspace = await assertWorkspaceAccess(id, session.auth.userId);
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  const conversations = await db.select().from(ragConversations).where(and(eq(ragConversations.workspaceId, id), eq(ragConversations.ownerId, workspace.ownerId), eq(ragConversations.securityId, workspace.securityId), eq(ragConversations.userId, session.auth.actorUserId))).orderBy(desc(ragConversations.updatedAt)).limit(30);
  const ids = conversations.map((row) => row.id);
  const messages = ids.length ? await db.select().from(ragMessages).where(inArray(ragMessages.conversationId, ids)).orderBy(ragMessages.createdAt) : [];
  return NextResponse.json({ conversations, messages });
}
