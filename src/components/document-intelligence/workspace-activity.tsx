'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { IngestionStatus } from './ingestion-status';
export interface IngestionJobView { id: string; jobType: string; startedAt: string | null; documentsIngested: number | null; documentsDiscovered: number | null; status: string; errorMessage: string | null }
export function WorkspaceActivity({ workspaceId, initialJobs }: { workspaceId: string; initialJobs: IngestionJobView[] }) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs); const [error, setError] = useState('');
  useEffect(() => { setJobs(initialJobs); }, [initialJobs]);
  const active = jobs.some(job => ['queued', 'running'].includes(job.status));
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}`, { signal: controller.signal, cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Ingestion status could not refresh');
        if (!controller.signal.aborted) { setJobs(body.jobs); setError(''); if (!body.jobs.some((job: IngestionJobView) => ['queued', 'running'].includes(job.status))) router.refresh(); }
      } catch { if (!controller.signal.aborted) setError('Live ingestion status could not refresh. Saved activity remains visible; automatic refresh will retry.'); }
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 4000);
    };
    timer = setTimeout(() => void refresh(), 4000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, workspaceId, router]);
  return <section className="card glass-panel table-scroll" aria-label="Document ingestion activity"><h2>Ingestion activity</h2>
    <p className="note">The worker retrieves filings and adapted news, validates documents and indexes evidence. It does not alter holdings or accept investment conclusions.</p>
    {active && <p role="status">Retrieving and indexing sources. Completed document counts are work performed, not a guarantee of coverage.</p>}
    {error && <p role="alert" className="caveat">{error}</p>}
    <table><thead><tr><th scope="col">Job</th><th scope="col">Started</th><th scope="col">Documents</th><th scope="col">Status / next action</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td>{job.jobType.replaceAll('_', ' ')}</td><td>{job.startedAt ? new Date(job.startedAt).toLocaleString() : 'Queued'}</td><td>{job.documentsIngested ?? 0} / {job.documentsDiscovered ?? 0}</td><td><IngestionStatus status={job.status} error={job.errorMessage} />{job.errorMessage && <p className="caveat">{job.errorMessage} Review provider configuration and refresh sources after correcting the issue.</p>}</td></tr>)}</tbody></table>
    {!jobs.length && <p className="note">Initial ingestion has not started.</p>}
  </section>;
}
