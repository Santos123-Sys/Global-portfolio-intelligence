import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signSessionPayload } from '../src/lib/session-token';

for (const width of [390, 1440]) {
  test(`workspace navigation and keyboard access at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const token = await signSessionPayload(`${randomUUID()}.${Date.now() + 3600000}.${randomBytes(32).toString('base64url')}`, 'browser-test-only-session-secret-at-least-32-characters');
    await context.addCookies([{ name: 'portfolio_session', value: token, url: 'http://127.0.0.1:3100' }]);
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      const body = path === '/api/workflow/status'
        ? { workflow: { strategy: 'complete', discovery: 'complete', research: 'ready', portfolio: 'locked', approvedStrategyVersion: 1, nextAction: { href: '/research', label: 'Review company research', reason: 'Discovery finished.' } } }
        : { account: { isPlatformAdmin: false }, accounts: [], portfolios: [], analyses: [], versions: [] };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('/how-it-works');
    await expect(page.getByRole('heading', { name: 'Choose your next step' })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#workspace-content')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/workspace-${width}.png`, fullPage: true, animations: 'disabled' });

    const sidebar = page.getByRole('complementary', { name: 'Workspace navigation' });
    if (width < 820) {
      await page.getByRole('button', { name: 'Toggle workspace navigation' }).click();
      await expect(sidebar).toHaveClass(/is-open/);
    }

    const researchLink = sidebar.locator('a[href="/research"]');
    await expect(researchLink).toBeVisible();
    await expect(researchLink).toHaveAttribute('href', '/research');
    await expect(sidebar.locator('a[href="/research"]')).toHaveCount(1);
    await expect(sidebar.getByRole('link', { name: 'Investment Control' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Research Operations' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Research Operations' })).toHaveAttribute('href', '/research-operations');
    await expect(sidebar.getByRole('link', { name: 'Account Security' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Existing-Holdings Analysis' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Admin Activity' })).toHaveCount(0);

    await researchLink.focus();
    await expect(researchLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/research$/);
    await expect(page.getByRole('heading', { name: 'Research Workspace' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Investment workflow' }).getByRole('link', { name: /Analysis & valuation/ })).toHaveAttribute('aria-current', 'step');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
