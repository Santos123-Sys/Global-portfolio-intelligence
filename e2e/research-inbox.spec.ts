import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signSessionPayload } from '../src/lib/session-token';

for (const width of [390, 1440]) {
  test(`research inbox filters and preserves Discovery decisions at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const token = await signSessionPayload(`${randomUUID()}.${Date.now() + 3600000}.${randomBytes(32).toString('base64url')}`, 'browser-test-only-session-secret-at-least-32-characters');
    await context.addCookies([{ name: 'portfolio_session', value: token, url: 'http://127.0.0.1:3100' }]);
    const base = { portfolioRole: 'quality', investmentScore: 75, thesisAlignmentScore: 82, fundamentalSummary: 'Illustrative summary', thesisBreakers: [], analysisTimestamp: '2026-09-28T12:00:00.000Z' };
    const analyses = [
      { ...base, id: 'candidate', ticker: 'AAA', companyName: 'Alpine Example AG', portfolioCandidate: true, supersedesId: null },
      { ...base, id: 'violated', ticker: 'BBB', companyName: 'Breach Example AG', portfolioCandidate: false, thesisBreakers: ['Revenue floor breached'], supersedesId: null },
      { ...base, id: 'prior', ticker: 'CCC', companyName: 'Cedar Prior AG', portfolioCandidate: false, supersedesId: null },
      { ...base, id: 'changed', ticker: 'DDD', companyName: 'Delta Example AG', portfolioCandidate: false, supersedesId: 'prior' },
    ];
    await page.route('**/api/auth/session', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authenticated: true, account: { isPlatformAdmin: false } }) }));
    await page.route('**/api/analysis', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ analyses }) }));

    await page.goto('/research');
    await expect(page.getByRole('heading', { name: 'Research & Analysis Inbox' })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(3);
    await expect(page.getByText('Cedar Prior AG')).not.toBeVisible();
    await page.getByLabel('Include superseded analysis versions').check();
    await expect(page.getByRole('article')).toHaveCount(4);
    await page.getByLabel('Include superseded analysis versions').uncheck();
    await page.getByRole('button', { name: 'Candidates' }).click();
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByText('Alpine Example AG')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review candidates and decisions in Discovery' })).toHaveAttribute('href', '/ai-stock-discovery#candidate-review');
    await page.getByRole('button', { name: 'Thesis violations' }).click();
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByText('Revenue floor breached')).toBeVisible();
    await page.getByRole('button', { name: 'Changed' }).click();
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByText('Delta Example AG')).toBeVisible();
    await page.getByLabel('Search company, ticker or summary').fill('AAA');
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByText('No research matches these filters.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.goto('/candidates');
    await expect(page).toHaveURL(/\/research$/);
    await page.goto('/intelligence');
    await expect(page).toHaveURL(/\/research$/);
  });
}
