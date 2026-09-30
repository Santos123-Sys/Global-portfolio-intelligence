import { notFound } from 'next/navigation';
import { ChatInterface } from '@/components/document-intelligence/chat-interface';
import { WorkspaceNav } from '@/components/document-intelligence/workspace-nav';
import { assertWorkspaceAccess } from '@/lib/document-intelligence/workspace-manager';
import { requirePageSession } from '@/lib/page-auth';

export const dynamic = 'force-dynamic';
export default async function WorkspaceChat({ params }: { params: Promise<{ id: string }> }) { const session = await requirePageSession(); const { id } = await params; const workspace = await assertWorkspaceAccess(id, session.userId); if (!workspace) notFound(); return <main><section className="dashboard-hero"><p className="eyebrow">{workspace.ticker}</p><h1>Ask company documents</h1><p className="hero-lead">Answers are limited to indexed evidence and include the retrieved sources used for each response.</p></section><WorkspaceNav workspaceId={id} active="chat" /><ChatInterface workspaceId={id} enabled={workspace.ragEnabled} /></main>; }
