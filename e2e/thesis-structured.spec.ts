import { randomBytes, randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { emptyThesisPolicy } from '@portfolio-intelligence/agentic-contract';
import { signSessionPayload } from '../src/lib/session-token';

for (const width of [390, 1440]) {
  test(`system-created portfolio strategy review at ${width}px`, async ({ page, context }) => {
    const token = await signSessionPayload(
      `${randomUUID()}.${Date.now() + 3600000}.${randomBytes(32).toString('base64url')}`,
      'browser-test-only-session-secret-at-least-32-characters',
    );
    const ownerId = randomUUID();
    const extraction = {
      id: 'extraction', externalExtractionId: 'extraction-ref', status: 'completed', requestedVersion: 1,
      sourceFileName: 'strategy.txt', requestedAt: '2026-09-30', confirmedAt: null,
      resultJson: {
        criteria: { version: 1, portfolios: [{ role: 'brazilian_growth', currency: 'BRL', objective: 'Long-term Brazilian growth', inclusionCriteria: ['B3 primary listing'], exclusionCriteria: [], policy: { ...emptyThesisPolicy(), name: 'Brazilian Growth', universe: { ...emptyThesisPolicy().universe, listingMarkets: ['BVMF'] } } }], globalConstraints: [] },
        extractionConfidence: 0.94, ambiguousPoints: [], unmappedContent: [],
      },
    };
    let approval: Record<string, unknown> | null = null;
    await context.addCookies([{ name: 'portfolio_session', value: token, url: 'http://127.0.0.1:3100' }]);
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (path === '/api/auth/session') return json({ account: { isPlatformAdmin: true } });
      if (path === '/api/accounts') return json({ accounts: [], activeAccountId: '' });
      if (path === '/api/thesis' && route.request().method() === 'POST') {
        approval = route.request().postDataJSON();
        return json({ version: { id: randomUUID() }, discoveryTransition: { status: 'not_requested' } }, 201);
      }
      if (path === '/api/thesis') return json({ versions: [], nextVersion: 1, ownerId });
      if (path === '/api/integrations/agentic/thesis-extractions' && route.request().method() === 'POST') return json({ extraction });
      if (path === '/api/integrations/agentic/thesis-extractions') return json({ extractions: [] });
      return json({});
    });

    await page.setViewportSize({ width, height: 900 });
    await page.goto('/investment-thesis');
    await expect(page.getByRole('heading', { name: 'Portfolio Strategy' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create structured thesis' })).not.toBeVisible();
    await expect(page.getByText('Other ways to create a thesis')).not.toBeVisible();
    await expect(page.getByText(/Every portfolio destination needs/)).not.toBeVisible();

    const extractionResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/integrations/agentic/thesis-extractions'
      && response.request().method() === 'POST',
    );
    await page.getByLabel('Choose strategy document').setInputFiles({ name: 'strategy.txt', mimeType: 'text/plain', buffer: Buffer.from('Long-term Brazilian growth strategy; B3 primary listings.') });
    expect((await extractionResponse).ok()).toBe(true);
    await expect(page.getByRole('heading', { name: 'Review portfolio strategy' })).toBeVisible({ timeout: 15000 });

    // A valid generated strategy keeps the raw structured editor collapsed by default.
    // Open it explicitly before asserting editable fields so this test exercises the
    // intended progressive-disclosure contract instead of racing review classification.
    const mandateEditor = page.locator('details.strategy-editor-details');
    await expect(mandateEditor).toBeVisible();
    if (!(await mandateEditor.evaluate(element => (element as HTMLDetailsElement).open))) {
      await mandateEditor.locator(':scope > summary').click();
    }
    await expect(page.getByLabel('Base currency for mandate 1')).toHaveValue('BRL');

    const note = page.getByLabel('Review note (required)');
    if (await note.isVisible()) await note.fill('Reviewed the generated policy and confirmed the intended B3 market coverage.');
    await expect(page.getByRole('button', { name: 'Approve strategy and start research' })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.getByRole('button', { name: 'Approve strategy and start research' }).click();
    await expect(page.getByText('Strategy approved. Open Discovery when you are ready to search using this version.')).toBeVisible();
    expect(approval).toMatchObject({ externalExtractionId: 'extraction-ref', criteriaJson: { version: 1, portfolios: [{ role: 'brazilian_growth', currency: 'BRL' }] }, startDiscovery: true });
  });
}
