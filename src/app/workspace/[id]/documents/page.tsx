import { and, desc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { DocumentList } from '@/components/document-intelligence/document-list';
import { DocumentUpload } from '@/components/document-intelligence/document-upload';
import { WorkspaceNav } from '@/components/document-intelligence/workspace-nav';
import { db } from '@/lib/db';
import { intelligenceDocuments } from '@/lib/db/workflow-schema';
import { assertWorkspaceAccess } from '@/lib/document-intelligence/workspace-manager';
import { requirePageSession } from '@/lib/page-auth';

export const dynamic = 'force-dynamic';
export default async function WorkspaceDocuments({ params }: { params: Promise<{ id: string }> }) { const session = await requirePageSession(); const { id } = await params; const workspace = await assertWorkspaceAccess(id, session.userId); if (!workspace) notFound(); const documents = await db.select({ id: intelligenceDocuments.id, title: intelligenceDocuments.title, folderType: intelligenceDocuments.folderType, documentType: intelligenceDocuments.documentType, source: intelligenceDocuments.source, url: intelligenceDocuments.url, publishedDate: intelligenceDocuments.publishedDate, processingStatus: intelligenceDocuments.processingStatus, processingError: intelligenceDocuments.processingError, isPrimarySource: intelligenceDocuments.isPrimarySource, pageCount: intelligenceDocuments.pageCount }).from(intelligenceDocuments).where(and(eq(intelligenceDocuments.workspaceId, id), eq(intelligenceDocuments.ownerId, workspace.ownerId), eq(intelligenceDocuments.securityId, workspace.securityId))).orderBy(desc(intelligenceDocuments.publishedDate)); return <main><section className="dashboard-hero"><p className="eyebrow">{workspace.ticker}</p><h1>Document library</h1><p className="hero-lead">Automatic sources and reviewed uploads, organized by research purpose.</p></section><WorkspaceNav workspaceId={id} active="documents" /><DocumentUpload workspaceId={id} /><DocumentList documents={documents} /></main>; }
