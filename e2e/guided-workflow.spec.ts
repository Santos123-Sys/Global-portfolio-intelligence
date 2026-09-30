import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Page, type BrowserContext } from '@playwright/test';
import { signSessionPayload } from '../src/lib/session-token';

async function authenticate(context: BrowserContext, page: Page) {
  const token = await signSessionPayload(`${randomUUID()}.${Date.now() + 3600000}.${randomBytes(32).toString('base64url')}`, 'browser-test-only-session-secret-at-least-32-characters');
  await context.addCookies([{ name: 'portfolio_session', value: token, url: 'http://127.0.0.1:3100' }]);
  await page.route('**/api/auth/session', route => route.fulfill({ json: { account: { isPlatformAdmin: true } } }));
  await page.route('**/api/accounts', route => route.fulfill({ json: { accounts: [] } }));
}

const criteria = { version: 2, portfolios: [{ role: 'brazilian_growth', currency: 'BRL', objective: 'Long-term Brazilian growth', inclusionCriteria: ['B3 primary listing'], exclusionCriteria: [] }], globalConstraints: [] };

for (const width of [390, 1440]) {
  test(`thesis entry separates current strategy, upload and history at ${width}px`, async ({ page, context }) => {
    await authenticate(context, page);
    await page.setViewportSize({ width, height: 900 });
    let submitted = false;
    let approvals = 0;
    await page.route('**/api/thesis', route => {
      if (route.request().method() === 'POST') { approvals++; return route.fulfill({ json: {} }); }
      return route.fulfill({ json: { ownerId: 'fixture-owner', nextVersion: 3, versions: [
        { id: 'active', versionNumber: 2, supersededAt: null, effectiveDate: '2026-09-29', criteriaJson: criteria },
        { id: 'prior', versionNumber: 1, supersededAt: '2026-09-29', effectiveDate: '2026-09-28', criteriaJson: { ...criteria, version: 1 } },
      ] } });
    });
    await page.route('**/api/integrations/agentic/thesis-extractions*', route => {
      const extraction = { id: 'new', externalExtractionId: 'new-extraction', status: 'completed', requestedVersion: 3, sourceFileName: 'updated-thesis.txt', requestedAt: '2026-09-30', confirmedAt: null, resultJson: { criteria: { ...criteria, version: 3 }, extractionConfidence: 0.9, ambiguousPoints: [], unmappedContent: [] } };
      if (route.request().method() === 'POST') { submitted = true; return route.fulfill({ json: { extraction } }); }
      return route.fulfill({ json: { extractions: submitted ? [extraction] : [] } });
    });
    await page.goto('/investment-thesis');
    await expect(page.getByRole('heading', { name: 'Your approved thesis' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue to Discovery' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create structured thesis' })).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Version 1', exact: true })).not.toBeVisible();
    await page.screenshot({ path: `/tmp/guided-thesis-${width}.png`, fullPage: true });
    await page.getByLabel('Choose thesis document').setInputFiles({ name: 'updated-thesis.txt', mimeType: 'text/plain', buffer: Buffer.from('Long-term Brazilian growth. B3 primary listing.') });
    await expect(page.getByRole('heading', { name: 'Review and approve thesis' })).toBeVisible();
    await expect(page.locator('#thesis-review')).toBeFocused();
    await expect(page.getByLabel('Reporting currency for mandate 1')).toHaveValue('BRL');
    await expect(page.getByRole('button', { name: /Confirm thesis version 3/ })).toBeDisabled(); // prose still requires human acknowledgment
    expect(approvals).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('discovery keeps one review open and preserves filters without making decisions', async ({ page, context }) => {
  await authenticate(context, page);
  const candidates = ['Alpha', 'Beta'].map((name, index) => ({ id: name, ticker: name.toUpperCase(), companyName: name, runId: 'run', exchange: 'BVMF', currency: 'BRL', portfolioName: index ? 'Second mandate' : 'Brazilian Growth', decision: 'pending', workflowStatus: 'pending', country: 'Brazil', sector: 'Consumer', industry: 'Food', classificationSource: 'provider', analysis: null, risk: null, latestPrice: null, decisionJournal: null, evidenceScorecard: { assessment: 'limited', sourceUrlCount: 0, groundingFieldCount: 0, informationGapCount: 1, conflictCount: 0, marketPriceStatus: 'unavailable' }, discoveryJson: { rationale: `${name} research rationale`, matchedCriteria: [], violatedCriteria: [], informationGaps: ['Filings missing'], groundedIn: [], sourceUrls: [] } }));
  let decisions = 0;
  await page.route('**/api/discovery/runs', route => route.fulfill({ json: { runs: [{ id: 'run', status: 'completed', requestedAt: '2026-09-30', candidateCount: 2, portfolioCandidateCounts: [], resultJson: null }] } }));
  await page.route('**/api/discovery/candidates*', route => {
    if (route.request().method() === 'POST') decisions++;
    return route.fulfill({ json: { candidates } });
  });
  await page.goto('/ai-stock-discovery');
  await page.getByRole('button', { name: 'Review latest candidates' }).click();
  const panels = page.locator('.candidate-detail-panel');
  await expect(panels).toHaveCount(2);
  await panels.nth(0).locator('summary').first().click();
  await expect(panels.nth(0)).toHaveAttribute('open', '');
  await panels.nth(1).locator('summary').first().click();
  await expect(panels.nth(1)).toHaveAttribute('open', '');
  await expect(panels.nth(0)).not.toHaveAttribute('open', '');
  await page.getByLabel('Portfolio', { exact: true }).selectOption('Brazilian Growth');
  await expect(page.locator('.candidate-card')).toHaveCount(1);
  await page.getByLabel('Search company or ticker').fill('missing');
  await expect(page.getByText('No companies match these filters.')).toBeVisible();
  expect(decisions).toBe(0);
});

test('company review exposes descriptive valuation and analysis actions', async ({ page, context }) => {
  await authenticate(context, page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.route('**/api/security/TEST/dashboard', route => route.fulfill({ json: { company: { companyName: 'Test Company', ticker: 'TEST', exchange: 'BVMF', currency: 'BRL' }, securityId: 'test', viewerMode: false, analysis: null, analyses: [], position: null, latestPrice: null, priceHistory: [], fundamentals: {}, alerts: [], documents: { workspace: null, records: [] } } }));
  await page.route('**/api/security/TEST/valuation', route => route.fulfill({ json: { scenarios: [], observations: [] } }));
  await page.route('**/api/agents/sessions*', route => route.fulfill({ json: { sessions: [] } }));
  await page.goto('/security/TEST');
  await expect(page.getByRole('heading', { name: /Test Company/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'DCF & peers', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run company analysis', exact: true }).click();
  await expect(page).toHaveURL(/tab=agent-analysis/);
  await expect(page.getByRole('button', { name: 'Run analysis', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
