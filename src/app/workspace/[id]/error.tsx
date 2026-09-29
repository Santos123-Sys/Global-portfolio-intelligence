'use client';
export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <main><div className="card"><h1>Document workspace unavailable</h1><p className="note">The workspace could not be loaded.</p><button className="primary" onClick={reset}>Try again</button></div></main>; }
