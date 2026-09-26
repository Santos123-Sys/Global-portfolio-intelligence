import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signSessionPayload } from '../src/lib/session-token';

for (const width of [390, 1440]) {
  test(`workspace navigation and keyboard access at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const token = await signSessionPayload(`${randomUUID()}.${Date.now() + 3600000}.${randomBytes(32).toString('base64url')}`, 'browser-test-only-session-secret-at-least-32-characters');
    await context.addCookies([{ name: 'portfolio_session', value: token, url: 'http://127.0.0.1:3100' }]);
    await page.route('**/api/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ account: { isPlatformAdmin: false }, accounts: [], portfolios: [] }) }));
    await page.goto('/how-it-works');
    await expect(page.getByRole('heading', { name: 'Clarity at every decision.' })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#workspace-content')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/workspace-${width}.png`, fullPage: true, animations: 'disabled' });
    if (width < 640) await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('button', { name: 'Find a page' }).click();
    await page.getByLabel('Find a page', { exact: true }).fill('security');
    await expect(page.locator('#page-finder').getByRole('link', { name: 'Account Security' })).toBeVisible();
    await page.getByLabel('Find a page', { exact: true }).fill('agent-settings');
    await expect(page.getByRole('status')).toContainText('No matching pages');
    await page.keyboard.press('Escape');
    await expect(page.locator('#page-finder')).not.toBeVisible();
  });
}
