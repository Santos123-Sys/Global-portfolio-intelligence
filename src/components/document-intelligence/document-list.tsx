import { IngestionStatus } from './ingestion-status';

export interface DocumentListItem { id: string; title: string; folderType: string; documentType: string; source: string; url: string | null; publishedDate: Date | null; processingStatus: string; processingError: string | null; isPrimarySource: boolean; pageCount: number | null }
export function DocumentList({ documents }: { documents: DocumentListItem[] }) {
  if (!documents.length) return <div className="card"><p className="note">No documents have been discovered or uploaded yet.</p></div>;
  return <div className="card table-scroll"><table><thead><tr><th>Document</th><th>Folder</th><th>Source</th><th>Date</th><th>Status</th></tr></thead><tbody>{documents.map((document) => <tr key={document.id}><td><strong>{document.url ? <a href={document.url} target="_blank" rel="noreferrer">{document.title}</a> : document.title}</strong><br /><span className="note">{document.documentType}{document.pageCount ? ` · ${document.pageCount} pages` : ''}</span></td><td>{document.folderType.replaceAll('_', ' ')}</td><td>{document.source}{document.isPrimarySource ? <><br /><small>Primary</small></> : null}</td><td>{document.publishedDate ? new Date(document.publishedDate).toLocaleDateString() : '—'}</td><td><IngestionStatus status={document.processingStatus} error={document.processingError} /></td></tr>)}</tbody></table></div>;
}
