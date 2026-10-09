import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { FilingLensIssuer, FilingLensSnapshot, normalizeFilingLensIssuer, snapshotContent } from './filinglens-contract';

export class FilingLensReadError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'FilingLensReadError'; }
}
const mappings = z.record(FilingLensIssuer);
type Security = { ticker: string; exchange: string };
export type FilingLensReadState = { status: 'ready'; snapshot: FilingLensSnapshot } |
  { status: 'disabled' | 'unsupported_market' | 'identity_unmapped' | 'unavailable'; reason: string };

export function mappedFilingLensIssuer(security: Security, json: string): FilingLensIssuer | null {
  let parsed: z.infer<typeof mappings>;
  try { parsed = mappings.parse(JSON.parse(json)); }
  catch { throw new FilingLensReadError('invalid_issuer_mapping'); }
  const issuer = parsed[`${security.exchange.trim().toUpperCase()}:${security.ticker.trim().toUpperCase()}`];
  if (!issuer) return null;
  const expected = security.exchange === 'BVMF' ? 'br' : ['XNYS', 'XNAS', 'ARCX', 'XASE'].includes(security.exchange) ? 'us' : null;
  if (issuer.jurisdiction !== expected) throw new FilingLensReadError('issuer_market_mismatch');
  return issuer;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('application/json')) throw new FilingLensReadError('invalid_response_type');
  if (Number(response.headers.get('content-length')) > 256_000) throw new FilingLensReadError('response_too_large');
  const reader = response.body?.getReader();
  if (!reader) throw new FilingLensReadError('empty_response');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 256_000) { await reader.cancel(); throw new FilingLensReadError('response_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function readFilingLensSnapshot(issuer: FilingLensIssuer, options: {
  baseUrl: string; token: string; fetch?: typeof fetch; timeoutMs?: number;
}): Promise<FilingLensSnapshot> {
  let origin: URL;
  try { origin = new URL(options.baseUrl); } catch { throw new FilingLensReadError('invalid_finance_config'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
    options.token.length < 32 || /[\r\n]/.test(options.token)) throw new FilingLensReadError('invalid_finance_config');
  const identity = normalizeFilingLensIssuer(issuer.jurisdiction, issuer.registryId);
  const url = new URL(`/api/integration/v1/issuers/${identity.jurisdiction}/${identity.registryId}/financial-snapshot`, origin);
  const timeoutMs = options.timeoutMs ?? 6000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new FilingLensReadError('invalid_finance_config');
  const signal = AbortSignal.timeout(timeoutMs); // Includes both attempts and body reads.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      try { await delay(100 + Math.floor(Math.random() * 100), undefined, { signal }); }
      catch { throw new FilingLensReadError('finance_timeout'); }
    }
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(url, { method: 'GET', cache: 'no-store', redirect: 'error',
        headers: { accept: 'application/json', Authorization: `Bearer ${options.token}` }, signal });
    } catch {
      if (signal.aborted) throw new FilingLensReadError('finance_timeout');
      if (attempt === 0) continue;
      throw new FilingLensReadError('finance_network_error');
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) continue;
      throw new FilingLensReadError(response.status === 404 ? 'snapshot_not_found' :
        response.status === 401 || response.status === 403 ? 'finance_unauthorized' : 'finance_upstream_error');
    }
    let snapshot: FilingLensSnapshot;
    try { snapshot = FilingLensSnapshot.parse(await boundedJson(response)); }
    catch (error) {
      if (signal.aborted) throw new FilingLensReadError('finance_timeout');
      if (error instanceof FilingLensReadError) throw error;
      throw new FilingLensReadError('invalid_finance_contract');
    }
    if (snapshot.issuer.jurisdiction !== identity.jurisdiction || snapshot.issuer.registryId !== identity.registryId)
      throw new FilingLensReadError('finance_identity_mismatch');
    if (createHash('sha256').update(snapshotContent(snapshot)).digest('hex') !== snapshot.contentHash)
      throw new FilingLensReadError('finance_integrity_failed');
    return snapshot;
  }
  throw new FilingLensReadError('finance_upstream_error');
}

/** Server-only opt-in connector; service identity can only read public evidence. */
export async function loadFilingLensFinance(security: Security): Promise<FilingLensReadState> {
  if (process.env.FILINGLENS_READ_ENABLED !== 'true') return { status: 'disabled', reason: 'FilingLens public finance reads are not enabled.' };
  if (!['XNYS', 'XNAS', 'ARCX', 'XASE', 'BVMF'].includes(security.exchange))
    return { status: 'unsupported_market', reason: 'This integration covers US SEC and Brazilian CVM issuers only.' };
  try {
    const issuer = mappedFilingLensIssuer(security, process.env.FILINGLENS_ISSUER_MAP_JSON ?? '{}');
    if (!issuer) return { status: 'identity_unmapped', reason: 'Verified CIK/CNPJ mapping required; ticker guessing is disabled.' };
    return { status: 'ready', snapshot: await readFilingLensSnapshot(issuer, {
      baseUrl: process.env.FILINGLENS_API_URL ?? '', token: process.env.FILINGLENS_READ_API_TOKEN ?? '',
    }) };
  } catch (error) {
    return { status: 'unavailable', reason: error instanceof FilingLensReadError ? error.code : 'finance_read_failed' };
  }
}
