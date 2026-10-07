import { describe, expect, it } from 'vitest';
import { getApiConfig, getWorkerConfig } from '../src/config.js';

const common = {
  NODE_ENV: 'test',
  AGENTIC_DATABASE_URL: 'postgresql://agentic:agentic@localhost:5432/agentic',
  AGENTIC_SYSTEM_API_KEY: '12345678901234567890123456789012',
};

describe('Railway environment validation', () => {
  it('rejects dormant canonical research in production but accepts a wired finance database', () => {
    const production = {
      ...common, NODE_ENV: 'production', OPENAI_API_KEY: 'test-only',
      DASHBOARD_IMPORT_URL: 'http://dashboard.railway.internal:3000/api/integrations/agentic/import',
      BUCKET: 'reports', ENDPOINT: 'https://bucket.railway.app',
      ACCESS_KEY_ID: 'test-access', SECRET_ACCESS_KEY: 'test-secret',
    };
    expect(() => getWorkerConfig(production)).toThrow(/FINANCE_DATABASE_URL is required in production/);
    expect(getWorkerConfig({ ...production, FINANCE_DATABASE_URL: 'postgresql://finance:finance@localhost:5432/finance' }).FINANCE_DATABASE_URL)
      .toBe('postgresql://finance:finance@localhost:5432/finance');
    expect(() => getWorkerConfig({ ...production, FINANCE_DATABASE_URL: '' })).toThrow(/FINANCE_DATABASE_URL/);
    expect(() => getWorkerConfig({ ...production, FINANCE_DATABASE_URL: 'not-a-url' })).toThrow(/FINANCE_DATABASE_URL/);
  });

  it('accepts API configuration and rejects a partial bucket', () => {
    expect(getApiConfig(common).PORT).toBe(3001);
    expect(() => getApiConfig({ ...common, AGENTIC_BUCKET_NAME: 'reports' }))
      .toThrow(/configured together/);
  });

  it('maps Railway bucket variables for the worker', () => {
    const config = getWorkerConfig({
      ...common,
      OPENAI_API_KEY: 'openai-test-key',
      DASHBOARD_IMPORT_URL: 'http://dashboard.railway.internal:3000/api/integrations/agentic/import',
      BUCKET: 'reports',
      ENDPOINT: 'https://bucket.railway.app',
      REGION: 'auto',
      ACCESS_KEY_ID: 'access',
      SECRET_ACCESS_KEY: 'secret',
    });
    expect(config.AGENTIC_BUCKET_NAME).toBe('reports');
    expect(config.OPENAI_MODEL).toBe('gpt-6-sol');
    expect(config.MARITACA_DATA_MODEL).toBe('sabia-4-thinking');
  });
});
