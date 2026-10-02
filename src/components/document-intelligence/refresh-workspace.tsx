'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export function RefreshWorkspace({ workspaceId }: { workspaceId: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  async function refresh() {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Source refresh could not be queued');
      setNotice('Source refresh is queued. Ingestion activity below updates as documents are retrieved and indexed.'); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Source refresh could not be queued. Try again.'); }
    finally { setBusy(false); }
  }
  return <div><button className="secondary-button" type="button" disabled={busy} onClick={() => void refresh()}>{busy ? 'Queuing source refresh…' : 'Refresh sources'}</button>{notice && <p role="status" className="note">{notice}</p>}{error && <p role="alert" className="caveat">{error}</p>}</div>;
}
