import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { intelligenceDocuments } from '@/lib/db/workflow-schema';
import { ingestUploadedDocument } from '@/lib/document-intelligence/ingestion-pipeline';
import { FOLDER_TYPES } from '@/lib/document-intelligence/types';
import { assertWorkspaceAccess } from '@/lib/document-intelligence/workspace-manager';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
const uploadSchema = z.object({ title: z.string().trim().min(1).max(240), folderType: z.enum(FOLDER_TYPES), documentType: z.string().trim().min(1).max(100), publishedDate: z.string().date().optional() });

export async function GET(req: Request, context: Context) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const { id } = await context.params;
  const workspace = await assertWorkspaceAccess(id, session.auth.userId);
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  const rows = await db.select({ id: intelligenceDocuments.id, title: intelligenceDocuments.title, description: intelligenceDocuments.description, folderType: intelligenceDocuments.folderType, documentType: intelligenceDocuments.documentType, source: intelligenceDocuments.source, url: intelligenceDocuments.url, publishedDate: intelligenceDocuments.publishedDate, processingStatus: intelligenceDocuments.processingStatus, processingError: intelligenceDocuments.processingError, isPrimarySource: intelligenceDocuments.isPrimarySource, pageCount: intelligenceDocuments.pageCount, fileFormat: intelligenceDocuments.fileFormat, retrievedAt: intelligenceDocuments.retrievedAt }).from(intelligenceDocuments).where(and(eq(intelligenceDocuments.workspaceId, id), eq(intelligenceDocuments.ownerId, workspace.ownerId), eq(intelligenceDocuments.securityId, workspace.securityId))).orderBy(desc(intelligenceDocuments.publishedDate));
  return NextResponse.json({ documents: rows });
}

export async function POST(req: Request, context: Context) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  assertSameOrigin(req);
  const { id } = await context.params;
  const workspace = await assertWorkspaceAccess(id, session.auth.userId);
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
    if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: 'File exceeds the 50 MB limit' }, { status: 413 });
    const parsed = uploadSchema.parse({ title: form.get('title') || file.name, folderType: form.get('folderType') || 'OTHER_DOCUMENT', documentType: form.get('documentType') || 'MANUAL_UPLOAD', publishedDate: form.get('publishedDate') || undefined });
    const result = await ingestUploadedDocument(workspace, { ...parsed, publishedDate: parsed.publishedDate ? new Date(parsed.publishedDate) : null, bytes: Buffer.from(await file.arrayBuffer()), filename: file.name, contentType: file.type || 'application/octet-stream' });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid upload metadata', details: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Upload failed' }, { status: 422 });
  }
}
