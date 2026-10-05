import { randomBytes, randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { emptyThesisPolicy, type ThesisPolicy } from '@portfolio-intelligence/agentic-contract';
import { signSessionPayload } from '../src/lib/session-token';
import { emptyCreatorState, applyCreatorAction, prepareCreatorTurn, completeCreatorTurn, requiredCreatorProfile, type CreatorSession, type CreatorAction, type CreatorTurn } from '../src/lib/portfolio-creator-state';
import { INVESTOR_QUESTIONS } from '../src/lib/investor-profile';
import { sampleAnswers } from '../tests/fixtures/investor-profile';
import { criteriaFromPortfolioStrategy, type PortfolioStrategyDraft } from '../src/lib/portfolio-strategy-chat';
import type { z } from 'zod';

for (const width of [390, 1440]) {
  test(`Portfolio Creator profiles, scores, resumes and confirms a strategy at ${width}px`, async ({ page, context }) => {
    const token = await signSessionPayload(`${randomUUID()}.${Date.now() + 3600000}.${randomBytes(32).toString('base64url')}`, 'browser-test-only-session-secret-at-least-32-characters');
    const ownerId = randomUUID();
    const policy: ThesisPolicy = { ...emptyThesisPolicy(), name: 'Brazilian quality growth', strategy: 'Profitable long-term growth', horizon: 'Seven years or more', universe: { ...emptyThesisPolicy().universe, listingMarkets: ['BVMF'] }, rules: [{ statement: 'Positive free cash flow over a full cycle', kind: 'preference', category: 'selection' }] };
    const draft: PortfolioStrategyDraft = { title: 'Brazilian quality growth', investorName: 'Test investor', purpose: 'Invest in profitable Brazilian companies with durable growth.', timeHorizon: 'Seven years or more', riskTolerance: 'Moderate', reviewCadence: 'Quarterly', markets: ['B3 (BVMF)'], globalConstraints: [], mandates: [{ label: 'Brazilian quality growth', role: 'brazilian_growth', currency: 'BRL', objective: 'Invest in profitable Brazilian companies with durable growth.', inclusionCriteria: ['Positive free cash flow over a full cycle'], exclusionCriteria: [], policy }] };
    let saved: CreatorSession = { revision: 0, state: emptyCreatorState() };
    let approval: Record<string, unknown> | null = null;
    let modelCalls = 0;
    await context.addCookies([{ name: 'portfolio_session', value: token, url: 'http://127.0.0.1:3100' }]);
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname; const method = route.request().method();
      const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (path === '/api/auth/session') return json({ account: { isPlatformAdmin: true } });
      if (path === '/api/accounts') return json({ accounts: [], activeAccountId: '' });
      if (path === '/api/thesis' && method === 'POST') { approval = route.request().postDataJSON(); return json({ version: { id: randomUUID() }, discoveryTransition: { status: 'not_requested' } }, 201); }
      if (path === '/api/thesis') return json({ versions: [], nextVersion: 1, ownerId });
      if (path === '/api/integrations/agentic/thesis-extractions') return json({ extractions: [] });
      if (path === '/api/thesis/portfolio-creator' && method === 'GET') return json(saved);
      if (path === '/api/thesis/portfolio-creator' && method === 'PATCH') {
        const action = route.request().postDataJSON() as z.infer<typeof CreatorAction>;
        expect(action.revision).toBe(saved.revision);
        saved = { revision: saved.revision + 1, state: applyCreatorAction(saved.state, action) }; return json(saved);
      }
      if (path === '/api/thesis/portfolio-creator' && method === 'POST') {
        const input = route.request().postDataJSON() as z.infer<typeof CreatorTurn>;
        expect(requiredCreatorProfile(saved.state).score).toBe(48);
        modelCalls += 1;
        const working = prepareCreatorTurn(saved.state, input);
        if (modelCalls === 1) {
          saved = { revision: saved.revision + 2, state: { ...working, generationStatus: 'failed', generationStartedAt: null, error: 'The model is temporarily unavailable. Your answer is saved.' } };
          return json({ ...saved, error: saved.state.error }, 502);
        }
        saved = { revision: saved.revision + 2, state: completeCreatorTurn(working, { status: 'ready', missingFields: [], reply: 'Your profile and equity-sleeve scope are retained. Review this strategy.', draft }) };
        return json(saved);
      }
      if (path === '/api/thesis/portfolio-creator/draft') {
        const input = route.request().postDataJSON(); expect(input).toMatchObject({ revision: saved.revision, confirmed: true }); expect(input).not.toHaveProperty('draft');
        const criteria = criteriaFromPortfolioStrategy(saved.state.draft!, 1);
        const extraction = { id: randomUUID(), externalExtractionId: 'portfolio-creator:generated-test', status: 'completed', requestedVersion: 1, sourceFileName: 'brazilian-quality-growth-investment-thesis.pdf', resultJson: { criteria, extractionConfidence: 1, ambiguousPoints: [], unmappedContent: [] }, investorProfileJson: saved.state.profile, errorMessage: null, requestedAt: new Date().toISOString(), confirmedAt: null };
        saved = { revision: saved.revision + 1, state: { ...saved.state, phase: 'document_ready', extractionId: extraction.id } };
        return json({ extraction, session: saved, generatedDocument: { fileName: extraction.sourceFileName, contentBase64: Buffer.from('%PDF-test-only').toString('base64') } }, 201);
      }
      return json({});
    });
    await page.setViewportSize({ width, height: 900 }); await page.goto('/investment-thesis');
    await expect(page.getByRole('heading', { name: 'Portfolio Creator', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate strategy PDF and review' })).toHaveCount(0);
    for (let index = 0; index < INVESTOR_QUESTIONS.length; index++) {
      const question = INVESTOR_QUESTIONS[index];
      await expect(page.getByText(question.question, { exact: true })).toBeVisible();
      await page.getByRole('group', { name: 'Choose your answer' }).getByRole('button').nth(sampleAnswers[question.id]!.charCodeAt(0) - 65).click();
      if (index === 3) { await page.reload(); await expect(page.getByText('4/11 answers saved')).toBeVisible(); }
    }
    await expect(page.getByText('48/75', { exact: true })).toBeVisible();
    expect(modelCalls).toBe(0);
    await expect(page.getByRole('button', { name: 'Confirm profile and continue' })).toBeDisabled();
    await page.getByRole('checkbox', { name: /I reviewed the answers/ }).check();
    await page.getByRole('button', { name: 'Confirm profile and continue' }).click();
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
    expect((approval as unknown as { criteriaJson: { globalConstraints: string[] } }).criteriaJson.globalConstraints.join(' ')).toContain('48/75');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
