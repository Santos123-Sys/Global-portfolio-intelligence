export interface CitationView { documentId: string; documentTitle: string; source: string; publishedDate: string; excerpt: string; relevanceScore: number; isPrimarySource: boolean }
export function CitationCard({ citation, index }: { citation: CitationView; index: number }) {
  return <article className="card citation-card"><strong>[{index + 1}] {citation.documentTitle}</strong><p className="note">{citation.source}{citation.publishedDate ? ` · ${new Date(citation.publishedDate).toLocaleDateString()}` : ''}{citation.isPrimarySource ? ' · Primary source' : ''}</p><p>{citation.excerpt}</p><small>Relevance {(citation.relevanceScore * 100).toFixed(0)}%</small></article>;
}
