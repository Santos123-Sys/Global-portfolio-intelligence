import type { companyWorkspaces, ingestionJobs, intelligenceDocuments } from '@/lib/db/workflow-schema';

export default function DocumentIntelligencePanel({ workspaceCounts, documentCounts, recentJobs }: {
  workspaceCounts: Array<{ status: typeof companyWorkspaces.$inferSelect.status; total: number }>;
  documentCounts: Array<{ status: typeof intelligenceDocuments.$inferSelect.processingStatus; total: number }>;
  recentJobs: Array<typeof ingestionJobs.$inferSelect>;
}) {
  const failures = recentJobs.filter((job) => job.status === 'failed');
  return <section className="ops-panel">
    <p className="sub">Document ingestion, indexing volume, and pipeline failures across accounts.</p>
    <section className="metrics-grid" aria-label="Document intelligence totals">
      {workspaceCounts.map((row) => <div className="card" key={row.status}><span className="note">{row.status} workspaces</span><h2>{row.total}</h2></div>)}
      {documentCounts.map((row) => <div className="card" key={row.status}><span className="note">{row.status} documents</span><h2>{row.total}</h2></div>)}
    </section>
    <section className="card table-scroll"><h2>Recent ingestion jobs</h2>
      {recentJobs.length === 0 ? <p className="note">No ingestion jobs have been recorded yet.</p> : <table><thead><tr><th>Workspace</th><th>Type</th><th>Status</th><th>Started</th><th>Error</th></tr></thead><tbody>{recentJobs.map((job) => <tr key={job.id}><td>{job.workspaceId}</td><td>{job.jobType}</td><td>{job.status}</td><td>{job.startedAt?.toLocaleString() ?? 'Queued'}</td><td>{job.errorMessage ?? '—'}</td></tr>)}</tbody></table>}
      <p className="note">{failures.length} failed job(s) in the latest {recentJobs.length}.</p>
    </section>
  </section>;
}
