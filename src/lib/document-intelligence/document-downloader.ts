const MAX_FILE_SIZE = 50 * 1024 * 1024;

function publicHttpUrl(raw: string): URL {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || host === 'localhost' || host.endsWith('.local') || /^(127|10|0)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error('Document URL is not an allowed public HTTPS address');
  return url;
}
export async function downloadDocument(rawUrl: string): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
  const url = publicHttpUrl(rawUrl);
  let lastError: unknown;
  for (const delay of [0, 1_000, 5_000, 15_000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const response = await fetch(url, { headers: { accept: 'application/pdf,text/html,application/xhtml+xml,application/xml,text/xml,text/plain,*/*;q=0.5', 'user-agent': process.env.SEC_USER_AGENT ?? 'Portfolio Intelligence document-ingestion contact@example.invalid' }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Document download failed (${response.status})`);
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_FILE_SIZE) throw new Error('Document exceeds 50 MB limit');
      if (!response.body) throw new Error('Document response has no body');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > MAX_FILE_SIZE) { await reader.cancel(); throw new Error('Document exceeds 50 MB limit'); } chunks.push(next.value); }
      const bytes = Buffer.concat(chunks.map((value) => Buffer.from(value)), size);
      const filename = decodeURIComponent(url.pathname.split('/').at(-1) || 'document');
      return { bytes, contentType: response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream', filename };
    } catch (error) { lastError = error; if (error instanceof Error && /50 MB|allowed public/.test(error.message)) throw error; }
  }
  throw lastError instanceof Error ? lastError : new Error('Document download failed');
}
