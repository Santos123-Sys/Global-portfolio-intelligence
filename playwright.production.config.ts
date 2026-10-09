import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({ ...base, use: { ...base.use, extraHTTPHeaders: { 'x-forwarded-proto': 'https' } },
  webServer: { command: 'npm run start:standalone', url: 'http://127.0.0.1:3100/api/health', reuseExistingServer: false, timeout: 60_000,
    env: { PORT: '3100', NODE_ENV: 'production', PUBLIC_APP_URL: 'https://app.example',
      SESSION_SECRET: 'browser-test-only-session-secret-at-least-32-characters', DATABASE_URL: 'postgresql://browser:browser@127.0.0.1:5432/browser',
      FILINGLENS_READ_ENABLED: 'false', RESEARCH_MODEL_ENABLED: 'false' } } });
