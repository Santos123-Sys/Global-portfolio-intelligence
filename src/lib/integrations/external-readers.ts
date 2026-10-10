import { z } from 'zod';
import { PortfolioExposureV1, RiskRunV1, ValuationVersionV1 } from './shared-contracts';

export class ProviderReadError extends Error {
  constructor(readonly code: 'invalid_configuration' | 'request_failed' | 'provider_unavailable' |
    'invalid_contract' | 'identity_mismatch' | 'response_too_large') {
    super(code);
  }
}

type ProviderConfig = { baseUrl: string; token: string; fetch?: typeof fetch };

/** One bounded, read-only request. Provider failure cannot become a synthetic fact. */
async function externalJson(path: string, config: ProviderConfig): Promise<unknown> {
  let base: URL;
  try { base = new URL(config.baseUrl); } catch { throw new ProviderReadError('invalid_configuration'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search ||
    base.hash || base.pathname !== '/' || config.token.length < 32 ||
    /[\r\n]/.test(config.token)) throw new ProviderReadError('invalid_configuration');
  const url = new URL(path, base);
  const signal = AbortSignal.timeout(5000);
  let response: Response;
  try {
    response = await (config.fetch ?? fetch)(url, { method: 'GET', cache: 'no-store', redirect: 'error',
      signal, headers: { 'accept': 'application/json', Authorization: 'Bearer ' + config.token } });
  } catch { throw new ProviderReadError('request_failed'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderReadError('provider_unavailable');
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel(); throw new ProviderReadError('invalid_contract');
  }
  if (Number(response.headers.get('content-length')) > 128_000) {
    await response.body?.cancel(); throw new ProviderReadError('response_too_large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderReadError('invalid_contract');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 128_000) { await reader.cancel(); throw new ProviderReadError('response_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let raw: unknown;
  try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ProviderReadError('invalid_contract'); }
  return raw;
}

export async function readApprovedValuation(valuationId: string, issuerId: string, config: ProviderConfig) {
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(valuationId)) throw new ProviderReadError('invalid_configuration');
  const raw = await externalJson('/api/integration/v1/valuations/' + encodeURIComponent(valuationId), config);
  const parsed = ValuationVersionV1.safeParse(raw);
  if (!parsed.success) throw new ProviderReadError('invalid_contract');
  if (parsed.data.issuerId !== issuerId || parsed.data.valuationVersionId !== valuationId)
    throw new ProviderReadError('identity_mismatch');
  return parsed.data;
}

export async function readPortfolioExposure(portfolioId: string, workspaceId: string, config: ProviderConfig) {
  if (!z.string().uuid().safeParse(portfolioId).success || !z.string().uuid().safeParse(workspaceId).success)
    throw new ProviderReadError('invalid_configuration');
  const raw = await externalJson('/v1/portfolios/' + portfolioId + '/exposures', config);
  const parsed = PortfolioExposureV1.safeParse(raw);
  if (!parsed.success) throw new ProviderReadError('invalid_contract');
  if (parsed.data.portfolioId !== portfolioId || parsed.data.workspaceId !== workspaceId)
    throw new ProviderReadError('identity_mismatch');
  return parsed.data;
}

export async function readRiskRun(runId: string, portfolioId: string, workspaceId: string, config: ProviderConfig) {
  if (![runId, portfolioId, workspaceId].every(id => z.string().uuid().safeParse(id).success))
    throw new ProviderReadError('invalid_configuration');
  const raw = await externalJson('/v1/portfolio-risk-runs/' + runId, config);
  const parsed = RiskRunV1.safeParse(raw);
  if (!parsed.success) throw new ProviderReadError('invalid_contract');
  if (parsed.data.runId !== runId || parsed.data.portfolioId !== portfolioId || parsed.data.workspaceId !== workspaceId)
    throw new ProviderReadError('identity_mismatch');
  return parsed.data;
}

export function mappedRiskStudioWorkspace(accountId: string, json: string): string | null {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new ProviderReadError('invalid_configuration'); }
  const mapping = z.record(z.string().uuid(), z.string().uuid()).safeParse(raw);
  if (!mapping.success) throw new ProviderReadError('invalid_configuration');
  return mapping.data[accountId] ?? null;
}
