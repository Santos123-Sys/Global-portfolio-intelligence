export function DocumentViewer({ title, text, sourceUrl }: { title: string; text: string; sourceUrl?: string | null }) {
  return <article className="card"><h2>{title}</h2>{sourceUrl && <p><a href={sourceUrl} target="_blank" rel="noreferrer">Open original source</a></p>}<pre className="document-text">{text}</pre></article>;
}
