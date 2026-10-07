import { createRailwayContext, project, type ServiceNode } from 'railway/iac';
import { afterEach, expect, it, vi } from 'vitest';
import railwayDefinition from '../.railway/railway';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it('validates the shared production runtime using only variables declared on the worker', async () => {
  const definition = await railwayDefinition(createRailwayContext({ environment: 'production' }), project);
  const worker = (definition.resources ?? []).flat().find(
    (resource): resource is ServiceNode => resource.type === 'service' && resource.name === 'agentic-worker'
  );
  expect(worker).toBeDefined();
  // Stand-ins for resolved Railway references; no real keys or network calls.
  // Selecting by declared variable names makes omitted references fail here.
  const resolved: Record<string, string> = {
    NODE_ENV: 'production',
    FINANCE_DATABASE_URL: 'postgresql://fixture:fixture@localhost:5432/finance',
    SESSION_SECRET: 'fixture-session-secret-at-least-32-characters',
    PUBLIC_APP_URL: 'https://dashboard.example.com',
    MARKET_DATA_PROVIDER: 'eodhd', MARKET_DATA_API_KEY: 'fixture-market-key',
    DISCOVERY_PROVIDER: 'finnhub', FINNHUB_API_KEY: 'fixture-discovery-key',
    DISCOVERY_FALLBACK_PROVIDER: 'eodhd', GEMINI_API_KEY: 'fixture-gemini-key',
    AGENTIC_SYSTEM_API_KEY: 'fixture-api-secret-at-least-32-characters',
    AGENTIC_SYSTEM_BASE_URL: 'http://agentic-api.railway.internal:8080',
    AWS_S3_BUCKET: 'fixture-reports', AWS_ENDPOINT: 'https://bucket.example.com',
    AWS_ACCESS_KEY_ID: 'fixture-access', AWS_SECRET_ACCESS_KEY: 'fixture-secret',
    AWS_REGION: 'auto', WEB_SEARCH_PROVIDER: 'none',
  };
  for (const [name, value] of Object.entries(resolved)) {
    vi.stubEnv(name, name in (worker?.variables ?? {}) ? value : undefined);
  }
  vi.stubEnv('DATABASE_URL', process.env.FINANCE_DATABASE_URL);
  vi.resetModules();
  const { getEnv } = await import('@/lib/env');
  expect(getEnv()).toMatchObject({
    NODE_ENV: 'production', MARKET_DATA_PROVIDER: 'eodhd',
    DISCOVERY_PROVIDER: 'finnhub', AGENTIC_SYSTEM_BASE_URL: resolved.AGENTIC_SYSTEM_BASE_URL,
  });
});
