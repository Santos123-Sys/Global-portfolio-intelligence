import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signSessionPayload } from '../src/lib/session-token';

for (const width of [390, 1440]) {
  test(`discovery exposes live execution and the actual zero-result explanation at ${width}px`, async ({ page, context }) => {
    const payload = `${randomUUID()}.${Date.now() + 3_600_000}.${randomBytes(32).toString('base64url')}`;
    const value = await signSessionPayload(payload, 'browser-test-only-session-secret-at-least-32-characters');
    await context.addCookies([{ name: 'portfolio_session', value, url: 'http://127.0.0.1:3100' }]);
    await page.setViewportSize({ width, height: 844 });
    let completed = false;
    const reason = 'All supplied listings were excluded by the approved market constraints. No financial analysis or valuation was started.';
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      if (path === '/api/auth/session') return json({ account: { isPlatformAdmin: true } });
      if (path === '/api/accounts') return json({ accounts: [], activeAccountId: '' });
      if (path === '/api/discovery/candidates') return json({ candidates: [] });
      if (path === '/api/discovery/runs') return json({ runs: [{
        id: '11111111-1111-4111-8111-111111111111', requestedAt: '2026-10-02T09:31:00Z',
        status: completed ? 'completed' : 'running', candidateCount: 0, provider: 'eodhd',
        progress: completed ? undefined : { completed: 1, total: 5, currentStage: 'Retrieving evidence: BVMF:WEGE3' },
        syncWarning: completed ? undefined : 'Live agent status could not be refreshed. The last saved status is shown; refresh will retry automatically.',
        resultJson: { thesisVersion: 24 },
        portfolioCandidateCounts: [{ portfolioId: 'brazil', portfolioName: 'Brazilian Growth', count: 0, status: completed ? 'no_candidates' : 'pending', reason: completed ? reason : 'Research in progress' }],
      }] });
      return json({});
    });
    await page.goto('/ai-stock-discovery');
    const execution = page.getByRole('region', { name: 'Live research execution' });
    await expect(execution).toContainText('Retrieving evidence: BVMF:WEGE3');
    await expect(execution.getByRole('progressbar')).toHaveAttribute('value', '1');
    await expect(execution).toContainText('Live agent status could not be refreshed');
    completed = true;
    await expect(page.getByText(reason, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(execution).toContainText('Completed');
    await expect(execution.getByRole('progressbar')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
