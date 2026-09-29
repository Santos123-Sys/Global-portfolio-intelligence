'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export function RefreshWorkspace({ workspaceId }: { workspaceId: string }) { const router = useRouter(); const [busy, setBusy] = useState(false); return <button className="secondary" disabled={busy} onClick={async () => { setBusy(true); await fetch(`/api/workspaces/${workspaceId}`, { method: 'POST' }); router.refresh(); setBusy(false); }}>{busy ? 'Queued…' : 'Refresh sources'}</button>; }
