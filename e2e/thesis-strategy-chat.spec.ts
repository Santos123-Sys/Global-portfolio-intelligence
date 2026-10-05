import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signSessionPayload } from '../src/lib/session-token';

for (const width of [390, 1440]) {
  test(`Portfolio Creator profiles, scores, resumes and confirms a strategy at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const token = await signSessionPayload(`${randomUUID()}.${Date.now() + 3600000}.${randomBytes(32).toString('base64url')}`, 'browser-test-only-session-secret-at-least-32-characters');
    await context.addCookies([{ name: 'portfolio_session', value: token, url: 'http://127.0.0.1:3100' }]);

    const ownerId = '22222222-2222-4222-8222-222222222222';
    const extractionId = '33333333-3333-4333-8333-333333333333';
    let approval: unknown = null;
    let revision = 0;
    const saved = {
      state: {
        answers: {},
        profile: null as null | Record<string, unknown>,
        phase: 'profiling',
        messages: [] as Array<{ role: string; content: string }>,
        draft: null as null | Record<string, unknown>,
        generationStatus: 'idle',
        generationStartedAt: null,
        error: null as null | string,
        extractionId: null as null | string,
        language: 'en',
        baseVersionId: null,
      },
    };

    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const json = (value: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
      if (path === '/api/auth/session') return json({ account: { isPlatformAdmin: false } });
      if (path === '/api/accounts') return json({ accounts: [], activeAccountId: '' });
      if (path === '/api/workflow/status') return json({ workflow: { strategy: 'ready', discovery: 'locked', research: 'locked', portfolio: 'locked', approvedStrategyVersion: null, nextAction: { href: '/investment-thesis', label: 'Define and approve strategy', reason: 'Strategy required.' } } });
      if (path === '/api/thesis' && request.method() === 'POST') {
        approval = request.postDataJSON();
        return json({ version: { id: randomUUID() }, discoveryTransition: { status: 'not_requested' } });
      }
      if (path === '/api/thesis') return json({ ownerId, nextVersion: 1, versions: [] });
      if (path === '/api/integrations/agentic/thesis-extractions') {
        if (!saved.state.extractionId) return json({ extractions: [] });
        return json({ extractions: [{
          id: extractionId,
          externalExtractionId: saved.state.extractionId,
          status: 'completed',
          requestedVersion: 1,
          sourceFileName: 'investment-thesis.pdf',
          requestedAt: '2026-10-02T09:00:00Z',
          confirmedAt: null,
          investorProfileJson: saved.state.profile,
          resultJson: {
            criteria: saved.state.draft,
            extractionConfidence: 1,
            ambiguousPoints: [],
            unmappedContent: [],
          },
        }] });
      }
      if (path === '/api/thesis/pdf') return route.fulfill({ contentType: 'application/pdf', body: Buffer.from('%PDF-1.4\n%%EOF') });
      if (path === '/api/thesis/portfolio-creator') {
        if (request.method() === 'GET') return json({ revision, state: saved.state });
        const body = request.postDataJSON() as { action?: string; answer?: string; revision?: number };
        revision += 1;
        if (body.action === 'answer' && body.answer) {
          saved.state.messages.push({ role: 'user', content: body.answer });
          if (saved.state.messages.length === 1) {
            saved.state.error = 'Temporary model error';
            return json({ revision, state: saved.state });
          }
          saved.state.error = null;
          saved.state.profile = { score: 48, maxScore: 75, classification: 'balanced', suggestedAllocation: { stocksPct: 50, bondsPct: 50 }, confirmedAt: '2026-10-02T09:00:00Z' };
          saved.state.phase = 'proposal';
          saved.state.draft = {
            version: 1,
            portfolios: [{ role: 'brazilian_growth', currency: 'BRL', objective: 'Long-term profitable growth', inclusionCriteria: [], exclusionCriteria: [], policy: { name: 'Brazil Growth', strategy: 'Profitable growth', horizon: '5+ years', targetHoldings: null, maximumHoldings: null, maximumPositionWeightPct: null, universe: { listingMarkets: ['BVMF'], domicileCountries: [], operatingCountries: [], revenueCountries: [], sectorsIncluded: [], sectorsExcluded: [], industriesIncluded: [], industriesExcluded: [], assetTypesIncluded: ['Common Stock'] }, rules: [] } }],
            globalConstraints: ['Investor profile: balanced; questionnaire 48/75.', 'Strategy scope: 100% equities requested by investor.', 'Liquidity context: long-term horizon.'],
          };
          return json({ revision, state: saved.state });
        }
        if (body.action === 'retry') {
          saved.state.error = null;
          saved.state.profile = { score: 48, maxScore: 75, classification: 'balanced', suggestedAllocation: { stocksPct: 50, bondsPct: 50 }, confirmedAt: '2026-10-02T09:00:00Z' };
          saved.state.phase = 'proposal';
          saved.state.draft = {
            version: 1,
            portfolios: [{ role: 'brazilian_growth', currency: 'BRL', objective: 'Long-term profitable growth', inclusionCriteria: [], exclusionCriteria: [], policy: { name: 'Brazil Growth', strategy: 'Profitable growth', horizon: '5+ years', targetHoldings: null, maximumHoldings: null, maximumPositionWeightPct: null, universe: { listingMarkets: ['BVMF'], domicileCountries: [], operatingCountries: [], revenueCountries: [], sectorsIncluded: [], sectorsExcluded: [], industriesIncluded: [], industriesExcluded: [], assetTypesIncluded: ['Common Stock'] }, rules: [] } }],
            globalConstraints: ['Investor profile: balanced; questionnaire 48/75.', 'Strategy scope: 100% equities requested by investor.', 'Liquidity context: long-term horizon.'],
          };
          return json({ revision, state: saved.state });
        }
        if (body.action === 'generate') {
          saved.state.extractionId = 'portfolio-creator:generated-test';
          saved.state.generationStatus = 'completed';
          return json({ revision, state: saved.state, extractionId: saved.state.extractionId, downloadUrl: '/api/thesis/pdf?extractionId=generated' });
        }
        return json({ revision, state: saved.state });
      }
      return json({});
    });

    await page.goto('/investment-thesis');
    await page.getByLabel('Your answer', { exact: true }).fill('Brazilian equities for long-term profitable growth, moderate risk, quarterly review.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry the saved answer' })).toBeVisible();
    await page.getByRole('button', { name: 'Retry the saved answer' }).click();
    await expect(page.getByRole('heading', { name: 'Proposal ready for review' })).toBeVisible();
    expect(saved.state.messages.filter(message => message.role === 'user')).toHaveLength(1);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Proposal ready for review' })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Generate strategy PDF and review' }).click();
    expect((await download).suggestedFilename()).toContain('investment-thesis.pdf');
    await expect(page.getByRole('heading', { name: 'Review portfolio strategy' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ready', exact: true })).toBeVisible();
    await expect(page.getByText('The mandate is structured and ready to govern Discovery.')).toBeVisible();
    const reviewNote = page.getByLabel('Review note (required)');
    if (await reviewNote.isVisible()) await reviewNote.fill('Reviewed the confirmed profile, equity sleeve, B3 market and liquidity context before approval.');
    const approve = page.getByRole('button', { name: 'Approve strategy and start research' });
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(page.getByText('Strategy approved. Open Discovery when you are ready to search using this version.')).toBeVisible();
    expect(approval).toMatchObject({ externalExtractionId: 'portfolio-creator:generated-test', criteriaJson: { version: 1, portfolios: [{ role: 'brazilian_growth', currency: 'BRL' }] }, startDiscovery: true });
    expect((approval as { criteriaJson: { globalConstraints: string[] } }).criteriaJson.globalConstraints.join(' ')).toContain('48/75');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
