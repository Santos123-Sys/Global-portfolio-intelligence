import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signSessionPayload } from '../src/lib/session-token';

test('mandate review blocks conflicts and records corrections before confirmation', async ({ page, context }) => {
  const payload = `${randomUUID()}.${Date.now() + 3600000}.${randomBytes(32).toString('base64url')}`;
  const token = await signSessionPayload(payload, 'browser-test-only-session-secret-at-least-32-characters');
  await context.addCookies([{ name: 'portfolio_session', value: token, url: 'http://127.0.0.1:3100' }]);
  await page.setViewportSize({ width: 390, height: 844 });
  let confirmed = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (value: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/api/auth/session') return json({ account: { isPlatformAdmin: true } });
    if (path === '/api/accounts') return json({ accounts: [], activeAccountId: '' });
    if (path === '/api/thesis' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.criteriaJson.portfolios[0].objective).toBe('Long-term capital growth');
      expect(body.criteriaJson.portfolios[0].exclusionCriteria).toEqual(['High leverage']);
      expect(body.reviewNotes).toContain('five years');
      confirmed = true;
      return json({ version: { id: randomUUID() }, discoveryTransition: { status: 'blocked', errorMessage: 'Provider offline' } });
    }
    if (path === '/api/thesis') return json({ versions: [] });
    if (path === '/api/integrations/agentic/thesis-extractions') return json({ extractions: confirmed ? [] : [{
      id: '11111111-1111-4111-8111-111111111111', externalExtractionId: 'review-fixture', status: 'completed', requestedVersion: 1,
      sourceFileName: 'mandate.pdf', requestedAt: '2026-09-26T10:00:00Z', confirmedAt: null,
      resultJson: { criteria: { version: 1, portfolios: [{ role: 'swiss_quality', currency: 'CHF', objective: 'Old objective', inclusionCriteria: ['Recurring revenue'], exclusionCriteria: ['Recurring revenue'] }], globalConstraints: [] }, extractionConfidence: 0.9,
        ambiguousPoints: [{ location: 'Horizon', issue: 'Unclear horizon', sourceExcerpt: 'long term' }], unmappedContent: [] },
    }] });
    return json({});
  });
  await page.goto('/investment-thesis');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const confirm = page.getByRole('button', { name: /Confirm thesis version 1/ });
  await expect(confirm).toBeDisabled();
  await page.getByText('Source prose and legacy criteria', {exact:true}).click();
  await page.getByLabel('Exclusion criteria — one per line').fill('High leverage');
  await page.getByRole('textbox', { name: 'Investment objective', exact: true }).fill('Long-term capital growth');
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Review decision').fill('Interpreted long term as five years; removed the contradictory exclusion.');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByText(/The thesis was confirmed, but market research did not start/)).toBeVisible();
  expect(confirmed).toBe(true);
});

