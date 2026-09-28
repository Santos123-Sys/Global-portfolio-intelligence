import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signSessionPayload } from '../src/lib/session-token';

for (const width of [390, 1440]) {
  test(`populated example is usable and isolated at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const token = await signSessionPayload(`${randomUUID()}.${Date.now()+3600000}.${randomBytes(32).toString('base64url')}`, 'browser-test-only-session-secret-at-least-32-characters');
    await context.addCookies([{ name: 'portfolio_session', value: token, url: 'http://127.0.0.1:3100' }]);
    const assets = ['DEMO-ALP', 'DEMO-LIM', 'DEMO-CED', 'DEMO-RIG', 'DEMO-AAR', 'DEMO-TIC'];
    const metric = { cagr: .08, vol: .12, sharpe: .5, max_drawdown: -.16, ann_turnover: .45,
      mad_from_base: .02, cross_run_std: .02, score: .4, eligible: true, vol_inv: 8.33 };
    const names = ['1/N', 'MinVar', 'MaxSharpe', 'RiskParity', 'MaxDiv', 'Kelly_frac', 'BlackLitterman', 'HRP'];
    const equal = Object.fromEntries(assets.map(ticker => [ticker, 1 / 6]));
    const recommended = Object.fromEntries(assets.map((ticker, index) => [ticker, index === 0 ? .25 : .15]));
    let mutations = 0;
    await page.route('**/api/**', route => {
      if (route.request().method() !== 'GET') mutations++;
      const data = route.request().url().includes('/api/example-portfolio') ? { result: {
        data_kind: 'synthetic_educational_example', engine_version: 'portfolio-weights/1.0.0',
        inputs: { per_asset_max: .5 }, data_range: { start: '2022-01-03', end: '2025-11-12', rows: 1008 },
        weights_table: Object.fromEntries(names.map(name => [name, name === 'MinVar' ? recommended : equal])),
        sample_starting_weights: Object.fromEntries(assets.map(ticker => [ticker, 1 / 6])),
        asset_annualized_volatility: Object.fromEntries(assets.map(ticker => [ticker, .14])),
        recommendation: { recommended_method: 'MinVar', recommended_weights: recommended, stability_flag: null, constraint_flag: null,
          ranking: Object.fromEntries(names.map(name => [name, metric])), user_must_choose: true },
      } } : { account: { isPlatformAdmin: false }, accounts: [] };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto('/example-portfolio');
    await expect(page.getByRole('heading', { name: 'Illustrative Swiss Quality portfolio' })).toBeVisible();
    await expect(page.getByText('Educational example: fictional companies and synthetic prices.')).toBeVisible();
    await expect(page.getByRole('heading', { name: '04 · Compute portfolio weights' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Method comparison · synthetic out-of-sample history' })).toBeVisible();
    const method = page.getByRole('combobox', { name: 'Explore allocation method' });
    await expect(method).toHaveValue('MinVar');
    await method.selectOption('1/N');
    await expect(method).toHaveValue('1/N');
    expect(mutations).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
