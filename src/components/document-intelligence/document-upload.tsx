'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DocumentUpload({ workspaceId }: { workspaceId: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <form className="card" onSubmit={async (event) => { event.preventDefault(); const element = event.currentTarget; setBusy(true); setError(''); const form = new FormData(element); const response = await fetch(`/api/workspaces/${workspaceId}/documents`, { method: 'POST', body: form }).catch(() => null); if (!response?.ok) { const body = await response?.json().catch(() => null); setError(body?.error ?? 'Upload failed'); } else { element.reset(); router.refresh(); } setBusy(false); }}>
    <h2>Upload document</h2><div className="form-grid"><label>File<input required name="file" type="file" accept=".pdf,.txt,.html,.htm,.xml,.xbrl" /></label><label>Title<input name="title" maxLength={240} /></label><label>Folder<select name="folderType" defaultValue="OTHER_DOCUMENT"><option value="REGULATORY_FILING">Regulatory filing</option><option value="MATERIAL_FACT">Material fact</option><option value="FINANCIAL_REPORT">Financial report</option><option value="OTHER_DOCUMENT">Other document</option></select></label><label>Document type<input name="documentType" defaultValue="MANUAL_UPLOAD" maxLength={100} /></label></div><button className="primary" disabled={busy}>{busy ? 'Indexing…' : 'Upload and index'}</button>{error && <p className="error-text" role="alert">{error}</p>}
  </form>;
}
