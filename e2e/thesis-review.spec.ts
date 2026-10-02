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
  const confirm = page.getByRole('button', { name: 'Approve strategy and start research' });
  await expect(confirm).toBeDisabled();
  await page.getByText('Additional extracted criteria', {exact:true}).click();
  await page.getByLabel('Exclusion criteria — one per line').fill('High leverage');
  await page.getByRole('textbox', { name: 'Investment objective', exact: true }).fill('Long-term capital growth');
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Review note (required)').fill('Interpreted long term as five years; removed the contradictory exclusion.');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByText(/The strategy was approved, but market research did not start/)).toBeVisible();
  expect(confirmed).toBe(true);
});

test('a browser-restored review is cleared when its source was already approved', async ({ page, context }) => {
  const payload = `${randomUUID()}.${Date.now() + 3600000}.${randomBytes(32).toString('base64url')}`;
  const token = await signSessionPayload(payload, 'browser-test-only-session-secret-at-least-32-characters');
  const ownerId = '22222222-2222-4222-8222-222222222222';
  const extractionId = '33333333-3333-4333-8333-333333333333';
  const activeVersionId = '44444444-4444-4444-8444-444444444444';
  const criteria = { version: 1, portfolios: [{ role: 'swiss_quality', currency: 'CHF', objective: 'Long-term capital growth', inclusionCriteria: ['Recurring revenue'], exclusionCriteria: [] }], globalConstraints: [] };
  await context.addCookies([{ name: 'portfolio_session', value: token, url: 'http://127.0.0.1:3100' }]);
  await page.addInitScript(({ ownerId, extractionId, criteria }) => {
    sessionStorage.setItem(`thesis-draft:${ownerId}`, JSON.stringify({ schemaVersion: 1, manual: false, criteria, selectedId: extractionId, baseVersionId: null, reviewNotes: '' }));
  }, { ownerId, extractionId, criteria });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (value: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/api/auth/session') return json({ account: { isPlatformAdmin: true } });
    if (path === '/api/accounts') return json({ accounts: [], activeAccountId: '' });
    if (path === '/api/thesis') return json({ ownerId, nextVersion: 2, versions: [{ id: activeVersionId, versionNumber: 1, criteriaJson: criteria, effectiveDate: '2026-10-02T10:00:00Z', supersededAt: null }] });
    if (path === '/api/integrations/agentic/thesis-extractions') return json({ extractions: [{
      id: extractionId, externalExtractionId: 'portfolio-creator:confirmed-fixture', status: 'completed', requestedVersion: 1,
      sourceFileName: 'strategy.pdf', requestedAt: '2026-10-02T09:00:00Z', confirmedAt: '2026-10-02T10:00:00Z',
      resultJson: { criteria, extractionConfidence: 1, ambiguousPoints: [], unmappedContent: [] },
    }] });
    if (path === '/api/thesis/portfolio-creator') return json({ revision: 0, state: { answers: {}, profile: null, phase: 'profiling', messages: [], draft: null, generationStatus: 'idle', generationStartedAt: null, error: null, extractionId: null, language: 'en', baseVersionId: null } });
    return json({});
  });

  await page.goto('/investment-thesis');
  await expect(page.getByRole('heading', { name: 'Approved portfolio strategy' })).toBeVisible();
  await expect(page.getByText('The approved strategy changed while this document was being reviewed.')).toHaveCount(0);
  await expect(page.getByText('Draft saved in this browser tab — not yet approved')).toHaveCount(0);
  await expect(page.getByText('This draft was already approved. The current approved strategy is shown above.')).toBeVisible();
  expect(await page.evaluate(ownerId => sessionStorage.getItem(`thesis-draft:${ownerId}`), ownerId)).toBeNull();
});
