import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signSessionPayload } from '../src/lib/session-token';

for (const width of [390, 1440]) {
  test(`weight proposal requires explicit confirmation at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const token = await signSessionPayload(`${randomUUID()}.${Date.now()+3600000}.${randomBytes(32).toString('base64url')}`, 'browser-test-only-session-secret-at-least-32-characters');
    await context.addCookies([{ name: 'portfolio_session', value: token, url: 'http://127.0.0.1:3100' }]);
    const portfolioId = '00000000-0000-4000-8000-000000000001';
    const metric = { cagr: .1, vol: .2, sharpe: .4, max_drawdown: -.1, ann_turnover: .5, mad_from_base: 0, cross_run_std: 0, score: .4, eligible: true, vol_inv: 5 };
    const names = ['1/N', 'MinVar', 'MaxSharpe', 'RiskParity', 'MaxDiv', 'Kelly_frac', 'BlackLitterman', 'HRP'];
    const run = { id: '00000000-0000-4000-8000-000000000002', source: 'Synthetic UI fixture only', currency: 'BRL', priceHash: 'fixture', createdAt: new Date().toISOString(), confirmedAt: null, final: null,
      config: { per_asset_max: .6 }, result: { engine_version: 'portfolio-weights/1.0.0', data_range: { start: '2022-01-01', end: '2026-09-28' },
        weights_table: Object.fromEntries(names.map(m => [m, { A: .5, B: .5 }])),
        recommendation: { recommended_method: '1/N', recommended_weights: { A: .5, B: .5 }, stability_flag: null, constraint_flag: null,
          ranking: Object.fromEntries(names.map(m => [m, metric])), user_must_choose: true } } };
    let confirmations = 0;
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      let data: unknown = { account: { isPlatformAdmin: false }, accounts: [] };
      if (url.pathname === '/api/portfolios') data = { portfolios: [{ id: portfolioId, name: 'Test portfolio', baseCurrency: 'BRL' }] };
      if (url.pathname === '/api/positions') data = { positions: ['A', 'B'].map(ticker => ({ id: ticker, ticker, companyName: ticker, portfolioId, currency: 'BRL', weight: .5, marketValueNative: 100, lastPricedAt: new Date().toISOString() })) };
      if (url.pathname === '/api/portfolio/weights') {
        if (route.request().method() === 'PUT') {
          confirmations++;
          expect(route.request().postDataJSON()).toMatchObject({ confirm: true, userChoice: 'recommendation' });
          data = { final: { final_weights: { A: .5, B: .5 }, source: 'user accepted system recommendation', was_user_decision: true } };
        } else data = { runs: [run], current: null };
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/allocation');
    await expect(page.getByRole('heading', { name: 'Plan your target allocation' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recommendation: Equal weight' })).toBeVisible();
    expect(confirmations).toBe(0);
    await page.getByLabel('Decision', { exact: true }).selectOption('custom');
    await page.getByLabel('A (relative weight)', { exact: true }).fill('50');
    await page.getByLabel('B (relative weight)', { exact: true }).fill('50');
    await expect(page.getByRole('button', { name: 'Confirm target allocation' })).toBeDisabled();
    await page.getByLabel('I reviewed these warnings and choose to proceed.').check();
    await page.getByRole('button', { name: 'Defer decision' }).click();
    expect(confirmations).toBe(0);
    await page.getByLabel('Saved proposals').selectOption(run.id);
    await page.getByRole('button', { name: 'Confirm target allocation' }).click();
    await expect(page.getByText('Target allocation confirmed and audited. No trades were placed.')).toBeVisible();
    expect(confirmations).toBe(1);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
