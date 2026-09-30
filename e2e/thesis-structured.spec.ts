import { randomBytes, randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { signSessionPayload } from '../src/lib/session-token';
for (const width of [390, 1440])
  test(`structured thesis lifecycle at ${width}px`, async ({
    page,
    context,
  }) => {
    const token = await signSessionPayload(
      `${randomUUID()}.${Date.now() + 3600000}.${randomBytes(32).toString('base64url')}`,
      'browser-test-only-session-secret-at-least-32-characters',
    );
    await context.addCookies([
      { name: 'portfolio_session', value: token, url: 'http://127.0.0.1:3100' },
    ]);
    await page.setViewportSize({ width, height: 900 });
    const ownerId = randomUUID();
    let saved: Record<string, unknown> | undefined;
    let rejectApproval = true;
    const activeId = randomUUID();
    let currentVersion: Record<string, unknown> | null = null;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const json = (data: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(data),
        });
      if (path === '/api/auth/session')
        return json({ account: { isPlatformAdmin: true } });
      if (path === '/api/accounts')
        return json({ accounts: [], activeAccountId: '' });
      if (path === '/api/thesis' && route.request().method() === 'POST') {
        if (rejectApproval) {
          rejectApproval = false;
          currentVersion = { id: activeId, versionNumber: 1, supersededAt: null, effectiveDate: '2026-09-27T00:00:00Z', criteriaJson: { ...route.request().postDataJSON().criteriaJson, portfolios: [{ ...route.request().postDataJSON().criteriaJson.portfolios[0], objective: 'Existing approved objective' }] } };
          return json(
            {
              error:
                'The active thesis changed while you were editing. Reload and compare before approving.',
            },
            409,
          );
        }
        saved = route.request().postDataJSON();
        return json({
          version: { id: randomUUID() },
          discoveryTransition: { status: 'not_requested' },
        });
      }
      if (path === '/api/thesis')
        return json({ versions: currentVersion ? [currentVersion] : [], nextVersion: currentVersion ? 2 : 1, ownerId });
      if (path === '/api/integrations/agentic/thesis-extractions') {
        if (route.request().method() === 'POST') return json({ error: 'Document service unavailable' }, 503);
        return json({ extractions: [] });
      }
      return json({});
    });
    await page.goto('/investment-thesis');
    await page.getByText('Other ways to create a thesis', { exact: true }).click();
    await page
      .getByRole('button', { name: 'Create structured thesis' })
      .click();
    await page
      .getByLabel('Portfolio destination for mandate 1')
      .selectOption('brazilian_growth');
    await page.getByLabel('Reporting currency for mandate 1').fill('BRL');
    await page
      .getByLabel('Portfolio name', { exact: true })
      .last()
      .fill('Brazilian Growth');
    // Incomplete drafts must survive reload, including the empty objective.
    await expect(
      page.getByRole('status').filter({ hasText: 'Draft saved' }),
    ).toBeVisible();
    page.on('dialog', (d) => d.accept());
    await page.reload();
    await expect(
      page.getByLabel('Reporting currency for mandate 1'),
    ).toHaveValue('BRL');
    await page
      .getByRole('textbox', { name: 'Investment objective', exact: true })
      .fill('Long-term capital growth');
    await page
      .getByLabel('Listing markets (MICs, e.g. BVMF or XSWX)')
      .fill('BVMF');
    await page.getByLabel('Target holdings', { exact: true }).fill('20');
    await page.getByLabel('Maximum holdings', { exact: true }).fill('6');
    const approve = page.getByRole('button', {
      name: 'Approve without starting Discovery',
    });
    await expect(approve).toBeDisabled();
    await page.getByLabel('Target holdings', { exact: true }).fill('6');
    await expect(approve).toBeEnabled();
    await page.getByRole('button', { name: 'Add classified rule' }).click();
    await page.getByLabel('Statement', { exact: true }).fill('High quality');
    await expect(approve).toBeDisabled();
    await page
      .getByLabel('Review decision')
      .fill(
        'Quality is a qualitative preference; no minimum ROIC threshold is assumed.',
      );
    await expect(approve).toBeEnabled();
    await expect(
      page.getByRole('heading', { name: 'What Discovery will search for' }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.locator('input[type=file]').setInputFiles({ name: 'replacement.txt', mimeType: 'text/plain', buffer: Buffer.from('Replacement mandate') });
    await expect(page.getByRole('alert').filter({ hasText: 'Document service unavailable' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Investment objective', exact: true })).toHaveValue('Long-term capital growth');
    await page.screenshot({ path: `/tmp/thesis-${width}.png`, fullPage: true });
    await approve.click();
    await expect(page.getByRole('alert').filter({ hasText: 'The active thesis changed' })).toContainText(
      'active thesis changed',
    );
    await expect(
      page.getByRole('textbox', { name: 'Investment objective', exact: true }),
    ).toHaveValue('Long-term capital growth');
    await expect(approve).toBeDisabled();
    await page.getByRole('button', { name: 'Keep my edits and review against the latest version' }).click();
    await page.getByLabel('Review decision').fill('Compared with the current version; retained my quality preference without inventing thresholds.');
    await approve.click();
    await expect(
      page.getByText(
        'Thesis approved. Open Discovery when you are ready to search using this version.',
      ),
    ).toBeVisible();
    expect(saved).toMatchObject({
      startDiscovery: false,
      baseVersionId: activeId,
      criteriaJson: {
        version: 2,
        portfolios: [
          {
            currency: 'BRL',
            role: 'brazilian_growth',
            policy: { targetHoldings: 6, maximumHoldings: 6 },
          },
        ],
      },
    });
    expect(
      await page.evaluate(
        (id) => sessionStorage.getItem(`thesis-draft:${id}`),
        ownerId,
      ),
    ).toBeNull();
    expect(errors).toEqual([]);
  });
