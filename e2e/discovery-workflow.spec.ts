import { buildMarketPlan, marketContextFromRecord } from '@portfolio-intelligence/agentic-contract';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { buildFinancialAnalysisReport } from '../src/lib/financial-analysis-report';
import { threeCaseDiscountedCashFlow } from '../src/lib/quant/dcf';
import { deriveFcff } from '../src/lib/quant/fcff';
import { signSessionPayload } from '../src/lib/session-token';

const runId = '11111111-1111-4111-8111-111111111111';
const candidateId = '22222222-2222-4222-8222-222222222222';
const eligibility = { portfolioId: 'swiss', ticker: 'NESN', exchange: 'XSWX', issuerKey: 'listing:XSWX:NESN', status: 'eligible', reasons: [], rules: [{ criterion: 'Listing market', status: 'PASS', reason: 'XSWX; allowed: XSWX', sourceUrl: 'https://example.org/issuer', observedAt: '2026-09-26T00:00:00Z', thesisPath: 'policy.universe.listingMarkets' }] };
const screeningAudit = { thesisVersionId: runId, records: [eligibility, { ...eligibility, ticker: 'BANK', status: 'ineligible', reasons: ['Excluded Financials sector'], rules: [] }, { ...eligibility, ticker: 'UNKNOWN', status: 'unverified', reasons: ['Sector evidence unavailable'], rules: [] }], researchAttempted: 1, researchFailed: 0, modelCalls: 1, elapsedMs: 2500 };


test('thesis-matched discovery remains reviewable through approval and report access', async ({ page, context }) => {
  const expiry = Date.now() + 60 * 60_000;
  const payload = `${randomUUID()}.${expiry}.${randomBytes(32).toString('base64url')}`;
  const token = await signSessionPayload(payload, 'browser-test-only-session-secret-at-least-32-characters');
  await context.addCookies([{ name: 'portfolio_session', value: token, url: 'http://127.0.0.1:3100' }]);

  await page.setViewportSize({ width: 390, height: 844 });
  const financialInputs = { operating_income: 200, depreciation_and_amortization: 20, capital_expenditure: 50, pre_tax_income: 200, income_tax_expense: 40 };
  let savedDcf = false;
  let started = false;
  let approved = false;
  const candidate = () => ({
    id: candidateId, runId, ticker: 'NESN', exchange: 'XSWX', companyName: 'Nestle SA', currency: 'CHF',
    portfolioName: 'Swiss Quality', country: 'Switzerland', sector: 'Consumer', industry: 'Food', classificationSource: 'provider',
    decision: approved ? 'approved' : 'pending', workflowStatus: approved ? 'analysis_ready' : 'pending',
    analysisRunStatus: approved ? 'completed' : null, externalAnalysisRunId: approved ? 'analysis-1' : null,
    analysisRunError: null, analysisErrorMessage: null, reportUrl: approved ? '/api/integrations/agentic/reports?externalRunId=analysis-1' : null,
    analysisMode: 'limited_research_risk', dcfLocked: true, dcfLockReason: 'Statements unavailable',
    latestPrice: null, decisionJournal: null, risk: null, analysis: approved ? { investmentScore: 60, thesisAlignmentScore: 70, confidenceScore: 40, qualityScore: null, growthScore: null, riskScore: null, dividendScore: null, investmentThesis: 'Research lead with incomplete financial evidence.', fundamentalSummary: 'Partial annual filings.', keyCatalysts: [], keyRisks: ['Evidence gaps'], thesisBreakers: [], informationGaps: ['FCFF unavailable'], groundedIn: ['identity:ticker'], researchFramework: null } : null, valuation: null,
    evidenceScorecard: { assessment: 'developing', sourceUrlCount: 1, groundingFieldCount: 2, informationGapCount: 2, conflictCount: 0, marketPriceStatus: 'unavailable', summary: 'Initial evidence; gaps remain.' },
    discoveryJson: { discoveryContext: { thesisVersionId: runId, issuerKey: eligibility.issuerKey, channel: 'structured_universe', eligibility, evidence: [{ url: 'https://example.org/issuer', provider: 'fixture', kind: 'structured_record', tier: 'unclassified', retrievedAt: '2026-09-26T00:00:00Z', publishedAt: null }] }, thesisAlignmentScore: 81, rationale: 'Matches the quality mandate.', matchedCriteria: ['Swiss listing'], violatedCriteria: [], informationGaps: ['Check cash generation'], groundedIn: ['identity:ticker', 'identity:exchange'], sourceUrls: ['https://example.org/issuer'] },
  });
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (pathname === '/api/auth/session') return json({ account: { isPlatformAdmin: true } });
    if (pathname === '/api/discovery/valuations' && method === 'POST') {
      const { review } = route.request().postDataJSON();
      expect(review.market.context.incorporationCountry).toBe('CH');
      expect(review.market.capital.countryRiskPremium.value).toBe(0);
      expect(review.financialPeriodEnd).toBe('2025-12-31');
      expect(review.scenarios.base_case.discountRate).toBe(.10);
      expect(review.fcff.workingCapitalInvestment).toBe(20);
      const fcffDerivation = deriveFcff(financialInputs, review.fcff);
      const assumptions = Object.fromEntries(Object.entries(review.scenarios).map(([name, rates]) => [name, { ...(rates as object), currency: 'CHF', startingFreeCashFlow: fcffDerivation.value, forecastYears: 5, netDebt: 30, sharesOutstanding: 10, dataAsOf: '2025-12-31', sourceReferences: [review.sourceUrl] }])) as Parameters<typeof threeCaseDiscountedCashFlow>[0];
      savedDcf = true;
      return json({ scenario: { id: '33333333-3333-4333-8333-333333333333' }, result: { ...threeCaseDiscountedCashFlow(assumptions), fcffDerivation, review } }, 201);
    }
    if (pathname === '/api/discovery/valuations') return json({ marketPlan: buildMarketPlan(marketContextFromRecord({ exchange: 'XSWX', sector: 'Consumer' })), financialInputs, suitability: { status: 'insufficient_data', rationale: 'Review FCFF inputs.', missingFields: [] }, defaults: { currency: 'CHF', dataAsOf: '2025-12-31', netDebt: 30, sharesOutstanding: 10, sourceReferences: [] }, automaticReadiness: { ready: false, missingFinancialRecords: ['free_cash_flow_to_firm'], missingScenarioDrivers: ['review assumptions'], message: 'Review assumptions to calculate DCF.' }, latestScenario: null });
    if (pathname === '/api/discovery/comparables') return json({ error: 'Peers not yet reviewed.' }, 409);
    if (pathname === '/api/discovery/financial-report') return json(buildFinancialAnalysisReport({ companyName: 'Nestle SA', ticker: 'NESN', exchange: 'XSWX', currency: 'CHF', now: new Date('2026-09-26'), observations: ['2024-12-31', '2025-06-30'].map((observationDate, index) => ({ metricName: 'revenue', valueNumeric: String(100 + index * 20), observationDate, currency: 'CHF', sourceUrl: `https://example.test/${observationDate}`, sourceName: 'Annual filing', provider: 'investor-relations', status: 'OK', retrievedAt: new Date('2026-09-25') })) }));
    if (pathname === '/api/accounts') return json({ accounts: [], activeAccountId: '' });
    if (pathname === '/api/discovery/preflight') return json({ preflight: { ready: true, checkedAt: '2026-09-23T11:00:00.000Z', provider: 'finnhub', checks: [
      { label: 'Swiss SIX universe', detail: '25 securities available', status: 'ready' },
      { label: 'Brazilian B3 universe', detail: '25 securities available', status: 'ready' },
    ] } });
    if (pathname === '/api/discovery/runs' && method === 'POST') { started = true; return json({ run: { id: runId } }, 202); }
    if (pathname === '/api/discovery/runs') return json({ runs: started ? [{ id: runId, status: 'completed', requestedAt: '2026-09-23T11:00:00.000Z', candidateCount: 1, portfolioCandidateCounts: [{ portfolioId: 'swiss', portfolioName: 'Swiss Quality', count: 1, status: 'candidates_found', reason: 'One research lead' }], universeCoverage: { records: 25, truncated: true, unranked: true, providers: ['finnhub'], recordsByPortfolio: [{ portfolioId: 'swiss', count: 25 }] }, resultJson: { thesisVersion: 1, screeningAudit, limitations: ['Web research unavailable for XSWX:OTHER. Partial assessment.'] } }] : [] });
    if (pathname === '/api/discovery/candidates' && method === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.decision).toBe('approved');
      expect(body.journal.decisionReason).toContain('durable');
      expect(body.journal.expectedHoldingPeriod).toBe('3 years');
      approved = true;
      return json({ candidate: candidate() });
    }
    if (pathname === '/api/discovery/candidates') return json({ candidates: [candidate()] });
    return json({});
  });

  await page.goto('/how-it-works');
  await page.getByRole('link', { name: 'Open discovery' }).click();
  await expect(page.getByRole('heading', { name: 'Thesis-Driven Stock Discovery' })).toBeVisible();
  await page.getByRole('button', { name: 'Check readiness' }).click();
  await expect(page.getByText('Brazilian B3 universe')).toBeVisible();
  await page.getByRole('button', { name: 'Find thesis-matched stocks' }).click();
  await expect(page.getByRole('button', { name: 'Review latest candidates' })).toBeVisible();
  await expect(page.getByText(/this shortlist does not represent a ranked search/)).toBeVisible();
  await page.getByText('Research limitations and retrieval failures', { exact: true }).click();
  await expect(page.getByText(/Web research unavailable for XSWX:OTHER/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'From supplied universe to shortlist' })).toBeVisible();
  await page.getByText('Inspect eligibility and exclusions', { exact: true }).click();
  await expect(page.getByText('Excluded Financials sector')).toBeVisible();
  await expect(page.getByText('Sector evidence unavailable')).toBeVisible();
  await expect(page.getByText('Approved thesis version 1')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '/tmp/discovery-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '/tmp/discovery-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Review latest candidates' }).click();
  await expect(page.getByRole('heading', { name: /Nestle SA/ })).toBeVisible();
  await page.getByText('Review evidence, decision and analysis', { exact: true }).click();
  await expect(page.getByText('2 grounding fields', { exact: true })).toBeVisible();
  await expect(page.getByText(/not independently verified investment facts/)).toBeVisible();
  await page.getByText('Eligibility and evidence dates', { exact: true }).click();
  await expect(page.getByText(/retrieved 2026-09-26 · published unknown/)).toBeVisible();
  const approve = page.getByRole('button', { name: 'Approve & analyze' });
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Complete these fields before approval:' })).toBeVisible();
  await page.getByLabel('Why does this fit the thesis?').fill('A durable competitive advantage warrants deeper analysis.');
  await page.getByLabel('Expected holding period').fill('3 years');
  await page.getByLabel('Current valuation view').fill('Test normalized cash flows before investing.');
  await page.getByLabel('Principal risk').fill('Margin compression from input costs.');
  await page.getByLabel('What would invalidate the view?').fill('Sustained loss of pricing power.');
  await expect(page.getByText('Ready to approve and start analysis.')).toBeVisible();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByRole('link', { name: 'Open PDF report' })).toHaveAttribute('href', /reports\?externalRunId=analysis-1/);
  await page.getByRole('button', { name: 'Open embedded financial report' }).click();
  await expect(page.getByRole('heading', { name: 'Company financial report' })).toBeVisible();
  await expect(page.getByText(/Evidence status: Partial/)).toBeVisible();
  await expect(page.getByText(/Growth withheld:/)).toBeVisible();
  await expect(page.getByText('Retrieved 2026-09-25', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download PDF', exact: true })).toHaveAttribute('href', /financial-report\/pdf/);
  await expect(page.getByRole('heading', { name: 'DCF & peer valuation' })).toBeVisible();
  const generate = page.getByRole('button', { name: 'Generate three-case DCF' });
  await expect(generate).toBeDisabled();
  await page.getByLabel('Incorporation country code').fill('CH');
  await page.getByLabel('Company reporting currency').fill('CHF');
  await page.getByLabel('Accounting standard', { exact: true }).selectOption('IFRS');
  await page.getByLabel('Regulatory jurisdictions (country codes, comma separated)').fill('CH');
  await page.getByRole('button', { name: 'Add revenue geography' }).click();
  await page.getByLabel('Country code', { exact: true }).fill('CH');
  await page.getByLabel('Revenue share (%)').fill('100');
  await page.getByLabel('Default-free rate (%)', { exact: true }).fill('4');
  await page.getByLabel('Mature-market equity risk premium (%)').fill('5');
  await page.getByLabel('Company-exposure country risk premium').fill('0');
  await page.getByLabel('Levered beta').fill('1.2');
  await page.getByLabel('Marginal tax rate (%)').fill('20');
  await page.getByLabel('Marginal debt yield').fill('5');
  await page.getByLabel('Market-value equity weight (%)').fill('100');
  await page.getByLabel('Inputs as of', { exact: true }).fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel('Filings / assumptions memo URL', { exact: true }).fill('https://example.test/assumptions');
  await expect(page.getByText('Computed base WACC: 10.0000%')).toBeVisible();
  await page.getByLabel('FCFF method').selectOption('ebit');
  await page.getByLabel('Non-cash working-capital investment — optional').fill('20');
  for (const name of ['worst case', 'base case', 'optimistic case']) {
    const group = page.getByRole('group', { name, exact: true });
    await group.getByLabel('Annual FCFF growth (%)').fill('4');
    if (name !== 'base case') await group.getByLabel('WACC (%)').fill('10');
    else await expect(group.getByLabel('WACC (%)')).toHaveAttribute('readonly', '');
    await group.getByLabel('Terminal growth (%)').fill('2');
  }
  await page.getByLabel('Assumptions reviewed as of').fill('2026-09-25');
  await page.getByLabel('Source / assumptions memo URL').fill('https://example.test/review');
  await page.getByLabel('Rationale and sources for rates and accounting adjustments').fill('Reviewed annual report and currency-consistent cost of capital.');
  await page.getByLabel('I reviewed the source, financial period').check();
  await expect(page.getByText('Computed FCFF: CHF 110', { exact: true })).toBeVisible();
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(page.getByRole('link', { name: 'Open DCF PDF report' })).toBeVisible();
  expect(savedDcf).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/market-review-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('Base-case sensitivity: WACC and terminal growth', { exact: true }).click();
  await expect(page.getByRole('table').filter({ has: page.getByText('Value per share (CHF); unavailable cells violate model constraints.') })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'DCF and peers: compare the evidence' })).toBeVisible();
  const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > window.innerWidth + 1).map(element => `${element.tagName}.${element.className}: ${Math.round(element.getBoundingClientRect().width)}`).slice(0, 25));
  await page.screenshot({ path: '/tmp/fcff-workspace.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), JSON.stringify(overflow)).toBe(true);

});

