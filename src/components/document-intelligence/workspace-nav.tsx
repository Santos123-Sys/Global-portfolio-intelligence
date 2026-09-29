import Link from 'next/link';

export function WorkspaceNav({ workspaceId, active }: { workspaceId: string; active: 'overview' | 'documents' | 'chat' }) {
  const items = [['overview', `/workspace/${workspaceId}`, 'Overview'], ['documents', `/workspace/${workspaceId}/documents`, 'Documents'], ['chat', `/workspace/${workspaceId}/chat`, 'Ask documents']] as const;
  return <nav className="workspace-nav" aria-label="Company document workspace">{items.map(([key, href, label]) => <Link className={active === key ? 'active' : ''} key={key} href={href}>{label}</Link>)}</nav>;
}
