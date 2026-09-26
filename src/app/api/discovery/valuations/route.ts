import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import {
  discoveryCandidates,
  marketDataObservations,
  valuationScenarios,
} from '@/lib/db/workflow-schema';
import { assessDcfSuitability, threeCaseDiscountedCashFlow } from '@/lib/quant/dcf';
import { FCFF_METRIC, FCFF_EVIDENCE_NOTE } from '@/lib/financial-evidence';
import { selectFilingSnapshot } from '@/lib/financial-filing-snapshot';

import { deriveFcff, FCFF_INPUTS } from '@/lib/quant/fcff';
import { valuationReviewSchema, type ValuationReview } from '@/lib/valuation-review';
import { readBoundedJson } from '@/lib/request-body';

export const runtime = 'nodejs';

const automaticValuationSchema = z.object({
  candidateId: z.string().uuid(),
  automatic: z.literal(true),
  review: valuationReviewSchema.optional(),
}).strict();

const SCENARIO_DRIVERS = {
  worst_case: {
    annualGrowthRate: 'dcf_worst_case_fcf_growth_rate',
    discountRate: 'dcf_worst_case_discount_rate',
    terminalGrowthRate: 'dcf_worst_case_terminal_growth_rate',
  },
  base_case: {
    annualGrowthRate: 'dcf_base_case_fcf_growth_rate',
    discountRate: 'dcf_base_case_discount_rate',
    terminalGrowthRate: 'dcf_base_case_terminal_growth_rate',
  },
  optimistic_case: {
    annualGrowthRate: 'dcf_optimistic_case_fcf_growth_rate',
    discountRate: 'dcf_optimistic_case_discount_rate',
    terminalGrowthRate: 'dcf_optimistic_case_terminal_growth_rate',
  },
} as const;

const REQUIRED_AUTOMATIC_FINANCIALS = [FCFF_METRIC, 'total_debt', 'cash_and_equivalents', 'shares_outstanding'] as const;
const REQUIRED_AUTOMATIC_DRIVERS = Object.values(SCENARIO_DRIVERS).flatMap((scenario) => Object.values(scenario));

async function context(ownerId: string, candidateId: string) {
  const [candidate] = await db.select().from(discoveryCandidates).where(and(
    eq(discoveryCandidates.id, candidateId),
    eq(discoveryCandidates.ownerId, ownerId)
  )).limit(1);
  if (!candidate || !candidate.securityId) return null;
  const observations = await db.select().from(marketDataObservations).where(and(
    eq(marketDataObservations.securityId, candidate.securityId),
    eq(marketDataObservations.observationType, 'fundamental'),
    eq(marketDataObservations.status, 'OK')
  )).orderBy(desc(marketDataObservations.retrievedAt));
  const latest = new Map<string, typeof observations[number]>();
  for (const observation of observations) if (!latest.has(observation.metricName)) latest.set(observation.metricName, observation);
  // Keep DCF inputs on one annual filing and one currency. A partial new import
  // must never silently borrow missing values from last year's report.
  const filingFacts = selectFilingSnapshot(observations, candidate.currency, [...FCFF_INPUTS, ...REQUIRED_AUTOMATIC_FINANCIALS]);
  for (const metric of [...FCFF_INPUTS, ...REQUIRED_AUTOMATIC_FINANCIALS]) {
    const matching = filingFacts.get(metric);
    if (matching) latest.set(metric, matching);
    else latest.delete(metric);
  }
  const facts = Object.fromEntries([...filingFacts].map(([key, row]) => [key, Number(row.valueNumeric)]));
  const dataAsOf = [...filingFacts.values()][0]?.observationDate ?? null;
  return { candidate, observations, latest, facts, dataAsOf };
}

function numeric(row: { valueNumeric: string | null } | undefined): number | null {
  if (!row?.valueNumeric) return null;
  const value = Number(row.valueNumeric);
  return Number.isFinite(value) ? value : null;
}

function automaticReadiness(data: NonNullable<Awaited<ReturnType<typeof context>>>, review?: ValuationReview) {
  const derivation = deriveFcff(data.facts, review?.fcff);
  const missingFinancialRecords = REQUIRED_AUTOMATIC_FINANCIALS.filter((metric) => {
    if (metric === FCFF_METRIC) return derivation.status !== 'ready' || derivation.value == null || derivation.value <= 0;
    const value = numeric(data.latest.get(metric));
    return value == null || data.latest.get(metric)?.provider !== 'investor-relations';
  });
  const missingScenarioDrivers = review ? [] : REQUIRED_AUTOMATIC_DRIVERS.filter((metric) => numeric(data.latest.get(metric)) == null);
  const suitability = assessDcfSuitability(data.candidate.sector, derivation.status === 'ready' ? [...data.latest.keys(), FCFF_METRIC] : data.latest.keys());
  const methodSupported = suitability.status !== 'alternative_method_recommended';
  return {
    fcffDerivation: derivation,
    ready: methodSupported && missingFinancialRecords.length === 0 && missingScenarioDrivers.length === 0,
    missingFinancialRecords,
    missingScenarioDrivers,
    message: !methodSupported ? suitability.rationale : missingFinancialRecords.length || missingScenarioDrivers.length
      ? `DCF needs complete financial inputs and sourced scenario drivers or reviewed assumptions. ${FCFF_EVIDENCE_NOTE} Review growth, WACC, and terminal growth below; no silent defaults are inserted.`
      : 'All source-linked financial and scenario-driver records are present. The native three-scenario DCF can be generated.',
  };
}

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const candidateId = new URL(req.url).searchParams.get('candidateId');
  if (!candidateId) return NextResponse.json({ error: 'candidateId is required' }, { status: 400 });
  const data = await context(session.auth.userId, candidateId);
  if (!data) return NextResponse.json({ error: 'Analyzed discovery candidate not found' }, { status: 404 });
  const derivation = deriveFcff(data.facts);
  const suitability = assessDcfSuitability(data.candidate.sector, derivation.status === 'ready' ? [...data.latest.keys(), FCFF_METRIC] : data.latest.keys());
  const debt = numeric(data.latest.get('total_debt'));
  const cash = numeric(data.latest.get('cash_and_equivalents'));
  const sourceReferences = [...data.latest.values()].map((row) => `fundamental:${row.metricName}:${row.id}`);
  const [latestScenario] = await db.select().from(valuationScenarios).where(and(
    eq(valuationScenarios.ownerId, session.auth.userId),
    eq(valuationScenarios.candidateId, candidateId),
    eq(valuationScenarios.method, 'three_case_two_stage_fcff')
  )).orderBy(desc(valuationScenarios.createdAt)).limit(1);
  return NextResponse.json({
    suitability,
    financialInputs: data.facts,
    fcffDerivation: derivation,
    defaults: {
      startingFreeCashFlow: derivation.value,
      netDebt: debt != null && cash != null ? debt - cash : null,
      sharesOutstanding: numeric(data.latest.get('shares_outstanding')),
      forecastYears: 5,
      annualGrowthRate: null,
      discountRate: null,
      terminalGrowthRate: null,
      currency: data.candidate.currency,
      dataAsOf: data.dataAsOf,
      sourceReferences,
    },
    automaticReadiness: automaticReadiness(data),
    latestScenario: latestScenario ?? null,
  });
}

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 });
  }
  const body = await readBoundedJson(req, 16 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = automaticValuationSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({
      error: 'Provide candidateId, automatic: true, and optionally complete, sourced, confirmed review assumptions.',
    }, { status: 400 });
  }
  const candidateId = parsed.data.candidateId;
  const data = await context(session.auth.userId, candidateId);
  if (!data || !data.candidate.analysisId) {
    return NextResponse.json({ error: 'Complete the approved security analysis before valuation' }, { status: 409 });
  }
  const review = parsed.data.review;
  if (review && (review.financialPeriodEnd !== data.dataAsOf || review.currency !== data.candidate.currency)) {
    return NextResponse.json({ error: 'The financial period or currency changed. Reload and review the current filing.' }, { status: 409 });
  }
  const readiness = automaticReadiness(data, review);
  if (!readiness.ready) return NextResponse.json({ error: readiness.message, readiness }, { status: 409 });
  const freeCashFlow = readiness.fcffDerivation.value!;
  const totalDebt = numeric(data.latest.get('total_debt'))!;
  const cash = numeric(data.latest.get('cash_and_equivalents'))!;
  const sharesOutstanding = numeric(data.latest.get('shares_outstanding'))!;
  const references = [...new Set([
    ...[...data.latest.values()].map(row => `fundamental:${row.metricName}:${row.id}`),
    ...(review ? [review.sourceUrl] : []),
  ])];
  try {
    const assumptions = Object.fromEntries(Object.entries(SCENARIO_DRIVERS).map(([name, drivers]) => [name, {
      currency: data.candidate.currency,
      startingFreeCashFlow: freeCashFlow,
      forecastYears: 5,
      annualGrowthRate: review ? review.scenarios[name as keyof typeof review.scenarios].annualGrowthRate : numeric(data.latest.get(drivers.annualGrowthRate))!,
      discountRate: review ? review.scenarios[name as keyof typeof review.scenarios].discountRate : numeric(data.latest.get(drivers.discountRate))!,
      terminalGrowthRate: review ? review.scenarios[name as keyof typeof review.scenarios].terminalGrowthRate : numeric(data.latest.get(drivers.terminalGrowthRate))!,
      netDebt: totalDebt - cash,
      sharesOutstanding,
      dataAsOf: data.dataAsOf!,
      sourceReferences: references,
    }])) as Parameters<typeof threeCaseDiscountedCashFlow>[0];
    const result = { ...threeCaseDiscountedCashFlow(assumptions), fcffDerivation: readiness.fcffDerivation, review: review ?? null };
    const [scenario] = await db.insert(valuationScenarios).values({
      ownerId: session.auth.userId,
      candidateId: data.candidate.id,
      analysisId: data.candidate.analysisId,
      method: result.method,
      status: review ? 'human_confirmed' : 'source_complete',
      assumptionsJson: { ...assumptions, review: review ?? null, financialInputs: data.facts, fcffDerivation: readiness.fcffDerivation },
      resultJson: result,
      sourceReferences: references,
      approvedBy: session.auth.email,
    }).returning();
    return NextResponse.json({ scenario, result }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
