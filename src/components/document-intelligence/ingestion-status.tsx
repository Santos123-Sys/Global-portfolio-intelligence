export function IngestionStatus({ status, error }: { status: string; error?: string | null }) {
  return <span className={`status status-${status}`} title={error ?? undefined}>{status.replaceAll('_', ' ')}</span>;
}
