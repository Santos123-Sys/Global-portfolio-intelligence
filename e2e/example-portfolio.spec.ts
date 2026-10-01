import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signSessionPayload } from '../src/lib/session-token';

for (const width of [390, 1440]) {
  test(`portfolio example progresses by stage at ${width}px without portfolio mutations`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const token = await signSessionPayload(`${randomUUID()}.${Date.now() + 3600000}.${randomBytes(32).toString('base64url')}`, 'browser-test-only-session-secret-at-least-32-characters');
    await context.addCookies([{ name: 'portfolio_session', value: token, url: 'http://127.0.0.1:3100' }]);

    const assets = ['DEMO-ALP', 'DEMO-LIM', 'DEMO-CED', 'DEMO-RIG', 'DEMO-AAR', 'DEMO-TIC'];
    const metric = { cagr: .08, vol: .12, sharpe: .5, max_drawdown: -.16, ann_turnover: .45,
      mad_from_base: .02, cross_run_std: .02, score: .4, eligible: true, vol_inv: 8.33 };
    const names = ['1/N', 'MinVar', 'MaxSharpe', 'RiskParity', 'MaxDiv', 'Kelly_frac', 'BlackLitterman', 'HRP'];
    const equal = Object.fromEntries(assets.map(ticker => [ticker, 1 / 6]));
    const recommended = Object.fromEntries(assets.map((ticker, index) => [ticker, index === 0 ? .25 : .15]));
    let mutations = 0;
    let sampleRequests = 0;
    await page.route('**/api/**', route => {
      if (route.request().method() !== 'GET') mutations++;
      if (route.request().url().includes('/api/example-portfolio')) sampleRequests++;
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
    await expect(page.getByRole('heading', { level: 1, name: 'Illustrative Swiss Quality portfolio' })).toBeVisible();
    await expect(page.getByText('Demonstration only: fictional companies and synthetic data.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Investment thesis' })).toBeVisible();
    await expect(page.locator('.example-viewport-desktop')).toHaveAttribute('data-demo-stage', 'thesis');
    expect(sampleRequests).toBe(0);

    await page.getByRole('link', { name: /Valuation/i }).click();
    await expect(page.locator(`${width < 900 ? '.example-viewport-mobile' : '.example-viewport-desktop'}[data-demo-stage="valuation"]`).getByText('Awaiting human review')).toBeVisible();
    expect(sampleRequests).toBe(0);

    for (const stage of ['discovery', 'candidate-review', 'approval']) {
      await page.getByRole('navigation', { name: 'Portfolio walkthrough progress' }).locator('a[href="#example-stage-' + stage + '"]').click();
      if (width < 900) await expect(page.locator('.example-viewport-mobile[data-demo-stage="' + stage + '"]')).toBeVisible();
      else await expect(page.locator('.example-viewport-desktop[data-demo-stage="' + stage + '"]')).toBeVisible();
    }

    const visibleVariant = width < 900 ? '.example-viewport-mobile' : '.example-viewport-desktop';
    const approvalPanel = page.locator(`${visibleVariant}[data-demo-stage="approval"]`);
    await approvalPanel.getByRole('button', { name: 'Preview user approval' }).click();
    await expect(approvalPanel.getByText('Example approval recorded locally')).toBeVisible();
    expect(sampleRequests).toBe(0);

    await page.getByRole('link', { name: /Financial analysis/i }).click();
    await expect(page.locator(`${visibleVariant}[data-demo-stage="analysis"]`).getByText('CHF 1320m')).toBeVisible();
    await page.getByRole('link', { name: /Valuation/i }).click();
    await expect(page.locator(`${visibleVariant}[data-demo-stage="valuation"]`).getByText('Comparable companies:', { exact: false })).toBeVisible();
    await expect(page.locator(`${visibleVariant}[data-demo-stage="valuation"]`).getByText('CHF', { exact: false }).first()).toBeVisible();

    await page.getByRole('link', { name: /Portfolio inclusion/i }).click();
    const portfolioPanel = page.locator(`${visibleVariant}[data-demo-stage="portfolio"]`);
    const method = portfolioPanel.getByRole('combobox', { name: 'Allocation method' });
    await expect(method).toHaveValue('MinVar');
    await expect(method.locator('option[value="MinVar"]')).toHaveText('Minimum variance · sample recommendation');
    await method.selectOption('1/N');
    await expect(method).toHaveValue('1/N');
    expect(sampleRequests).toBe(1);

    await page.getByRole('link', { name: /Monitoring/i }).click();
    await expect(page.locator(`${visibleVariant}[data-demo-stage="monitoring"]`).getByText('Not live monitoring')).toBeVisible();
    await expect(page.locator(`${visibleVariant}[data-demo-stage="monitoring"]`).getByText('Annualized volatility')).toBeVisible();

    await page.getByText('Open the complete example data and calculation tables').click();
    await expect(page.getByRole('heading', { name: 'Three-case DCF · illustrative CHF per share' })).toBeVisible();
    expect(mutations).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
