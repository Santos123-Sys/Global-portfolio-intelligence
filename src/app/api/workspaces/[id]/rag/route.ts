import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { askWorkspace } from '@/lib/document-intelligence/rag';
import { assertWorkspaceAccess } from '@/lib/document-intelligence/workspace-manager';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
const questionSchema = z.object({ question: z.string().trim().min(2).max(2_000), conversationId: z.string().uuid().optional() });

export async function POST(req: Request, context: Context) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  assertSameOrigin(req);
  const { id } = await context.params;
  const workspace = await assertWorkspaceAccess(id, session.auth.userId);
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  if (!workspace.ragEnabled) return NextResponse.json({ error: 'Document intelligence is not ready for this workspace' }, { status: 409 });
  try {
    const input = questionSchema.parse(await req.json());
    return NextResponse.json(await askWorkspace({ ...input, workspaceId: workspace.id, securityId: workspace.securityId, ownerId: workspace.ownerId, userId: session.auth.actorUserId }));
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid question', details: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'RAG request failed' }, { status: 502 });
  }
}
