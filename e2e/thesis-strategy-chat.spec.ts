import { randomBytes, randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { emptyThesisPolicy } from '@portfolio-intelligence/agentic-contract';
import { signSessionPayload } from '../src/lib/session-token';

for (const width of [390, 1440]) {
  test(`Gemini strategy interview generates a PDF and continues to review at ${width}px`, async ({ page, context }) => {
    const token = await signSessionPayload(
      `${randomUUID()}.${Date.now() + 3600000}.${randomBytes(32).toString('base64url')}`,
      'browser-test-only-session-secret-at-least-32-characters',
    );
    const ownerId = randomUUID();
    const policy = {
      ...emptyThesisPolicy(), name: 'Brazilian quality growth', strategy: 'Profitable long-term growth', horizon: 'Seven years or more',
      universe: { ...emptyThesisPolicy().universe, listingMarkets: ['BVMF'] },
      rules: [{ statement: 'Positive free cash flow over a full cycle', kind: 'preference', category: 'selection' }],
    } as const;
    const criteria = {
      version: 1,
      portfolios: [{ role: 'brazilian_growth', currency: 'BRL', objective: 'Invest in profitable Brazilian companies with durable growth.', inclusionCriteria: ['Positive free cash flow over a full cycle'], exclusionCriteria: [], policy }],
      globalConstraints: ['Risk posture: Moderate', 'Review cadence: Quarterly'],
    };
    const generatedExtraction = {
      id: randomUUID(), externalExtractionId: 'strategy-chat:generated-test', status: 'completed', requestedVersion: 1,
      sourceFileName: 'brazilian-quality-growth-investment-thesis.pdf', resultJson: { criteria, extractionConfidence: 1, ambiguousPoints: [], unmappedContent: [] },
      errorMessage: null, requestedAt: new Date().toISOString(), confirmedAt: null,
    };
    let approval: Record<string, unknown> | null = null;
    let chatTurns = 0;
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
      if (path === '/api/integrations/agentic/thesis-extractions') return json({ extractions: [] });
      if (path === '/api/thesis/strategy-chat' && route.request().method() === 'POST') {
        chatTurns += 1;
        if (chatTurns === 1) return json({ reply: 'Should I use Brazil (B3), and what risk posture fits your plan?', status: 'clarifying', missingFields: ['Risk posture'], draft: null });
        return json({ reply: 'This mandate is ready. Please check its objective, limits and selection rules before review.', status: 'ready', missingFields: [], draft: {
          title: 'Brazilian quality growth', investorName: 'Test investor', purpose: 'Invest in profitable Brazilian companies with durable growth.', timeHorizon: 'Seven years or more', riskTolerance: 'Moderate', reviewCadence: 'Quarterly', markets: ['B3 (BVMF)'], globalConstraints: [],
          mandates: [{ label: 'Brazilian quality growth', role: 'brazilian_growth', currency: 'BRL', objective: 'Invest in profitable Brazilian companies with durable growth.', inclusionCriteria: ['Positive free cash flow over a full cycle'], exclusionCriteria: [], policy }],
        } });
      }
      if (path === '/api/thesis/strategy-chat/draft') return json({ extraction: generatedExtraction, generatedDocument: { fileName: generatedExtraction.sourceFileName, contentBase64: Buffer.from('%PDF-1.4\n%%EOF').toString('base64') } }, 201);
      return json({});
    });

    await page.setViewportSize({ width, height: 900 });
    await page.goto('/investment-thesis');
    await expect(page.getByRole('heading', { name: 'Build your strategy with Gemini' })).toBeVisible();
    const answer = page.getByLabel('Your answer');
    await answer.fill('I want a long-term Brazilian equity portfolio of profitable growth companies.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Should I use Brazil (B3), and what risk posture fits your plan?')).toBeVisible();
    await answer.fill('Yes, B3. Use moderate risk and review it quarterly.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Draft ready for review')).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Generate strategy PDF and review' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(generatedExtraction.sourceFileName);
    await expect(page.getByRole('heading', { name: 'Review portfolio strategy' })).toBeVisible();
    await expect(page.getByLabel('Listing markets (MICs, e.g. BVMF or XSWX)')).toHaveValue('BVMF');
    const reviewNote = page.getByLabel('Review note (required)');
    if (await reviewNote.isVisible()) await reviewNote.fill('Reviewed the user criteria and confirmed the B3 universe and moderate risk posture.');
    await expect(page.getByRole('button', { name: 'Approve strategy and start research' })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Approve strategy and start research' }).click();
    await expect(page.getByText('Strategy approved. Open Discovery when you are ready to search using this version.')).toBeVisible();
    expect(approval).toMatchObject({ externalExtractionId: 'strategy-chat:generated-test', criteriaJson: { version: 1, portfolios: [{ role: 'brazilian_growth', currency: 'BRL' }] }, startDiscovery: true });
  });
}
