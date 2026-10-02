import { INVESTOR_QUESTIONS, profileWarningText, type InvestorProfileSnapshot } from './investor-profile';
import PDFDocument from 'pdfkit';
import type { ThesisCriteria, ThesisPolicy } from '@portfolio-intelligence/agentic-contract';
import { strategyPdfTitleFromCriteria } from './portfolio-strategy-chat';

export interface GeneratedThesisMandate {
  role: string;
  label: string;
  currency: string;
  objective: string;
  inclusionCriteria: string[];
  exclusionCriteria: string[];
  policy?: ThesisPolicy;
}

export interface GeneratedThesisInput {
  investorProfile?: InvestorProfileSnapshot;
  title: string;
  investorName: string;
  purpose: string;
  timeHorizon: string;
  riskTolerance: string;
  markets: string[];
  globalConstraints: string[];
  reviewCadence: string;
  mandates: GeneratedThesisMandate[];
}

const GREEN = '#113D30';
const GREEN_MID = '#2E6B51';
const PALE = '#EEF5EF';
const TEXT = '#17231D';
const MUTED = '#5C6B61';

function safeText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
}

function bulletList(document: PDFKit.PDFDocument, items: string[], empty: string): void {
  document.font('Helvetica').fontSize(10.5);
  if (!items.length) {
    document.fillColor(MUTED).text(empty, { indent: 10 });
    return;
  }
  for (const item of items) {
    document.fillColor(TEXT).text(`• ${safeText(item)}`, { indent: 10, paragraphGap: 3, lineGap: 1 });
  }
}

function section(document: PDFKit.PDFDocument, heading: string, value?: string): void {
  document.moveDown(0.75).fillColor(GREEN).font('Helvetica-Bold').fontSize(12).text(safeText(heading));
  if (value) document.moveDown(0.2).fillColor(TEXT).font('Helvetica').fontSize(10.5).text(safeText(value), { lineGap: 2 });
}

function policyLines(policy?: ThesisPolicy): string[] {
  if (!policy) return [];
  const universe = policy.universe;
  const fields: Array<[string, string[]]> = [
    ['Listing market', universe.listingMarkets], ['Domicile', universe.domicileCountries],
    ['Operating geography', universe.operatingCountries], ['Revenue exposure', universe.revenueCountries],
    ['Security type', universe.securityTypes], ['Required sectors', universe.sectorsIncluded],
    ['Excluded sectors', universe.sectorsExcluded], ['Required industries', universe.industriesIncluded],
    ['Excluded industries', universe.industriesExcluded],
  ];
  return fields.filter(([, values]) => values.length).map(([name, values]) => `${name}: ${values.join(', ')}`);
}

function ruleLines(policy?: ThesisPolicy): string[] {
  return (policy?.rules ?? []).map((rule) => {
    const effect = rule.kind === 'hard' ? 'Required' : rule.kind === 'preference' ? 'Preference' : 'Context';
    const metric = rule.metric ? ` — ${rule.metric.field} ${rule.metric.operator === 'gte' ? '≥' : '≤'} ${rule.metric.value} ${rule.metric.unit} (${rule.metric.period})` : '';
    return `${effect} · ${rule.category}: ${rule.statement}${metric}`;
  });
}

/**
 * Creates a short investor mandate inspired by equity research structure:
 * thesis summary, universe, selection debate, risks, controls and disclosure.
 * It intentionally contains no issuer facts, market forecasts or valuations.
 */
export async function renderGeneratedThesisPdf(input: GeneratedThesisInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: 'A4', margin: 50,
      info: { Title: safeText(input.title), Author: 'Portfolio Intelligence', Subject: 'Investor-authored portfolio mandate' },
    });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    document.rect(0, 0, document.page.width, document.page.height).fill('#FBFCFA');
    document.fillColor(GREEN).font('Helvetica-Bold').fontSize(10).text('PORTFOLIO INTELLIGENCE  /  INVESTMENT MANDATE', 50, 50);
    document.moveDown(3).fillColor(TEXT).fontSize(26).text(safeText(input.title), { width: 490, lineGap: 4 });
    document.moveDown(0.4).fillColor(GREEN_MID).font('Helvetica-Bold').fontSize(12).text('Portfolio strategy');
    document.moveDown(0.7).fillColor(MUTED).font('Helvetica').fontSize(10).text(`Prepared for ${safeText(input.investorName || 'Portfolio owner')}  ·  ${new Date().toISOString().slice(0, 10)}`);
    document.moveDown(1.4).fillColor(PALE).roundedRect(50, document.y, 495, 128, 12).fill();
    const summaryY = document.y + 17;
    document.fillColor(GREEN).font('Helvetica-Bold').fontSize(10).text('STRATEGY AT A GLANCE', 68, summaryY);
    document.fillColor(TEXT).font('Helvetica').fontSize(10).text(`Market: ${safeText(input.markets.join(' · ')) || 'Not specified'}`, 68, summaryY + 24, { width: 455 });
    document.text(`Horizon: ${safeText(input.timeHorizon)}     Review: ${safeText(input.reviewCadence)}`, 68, summaryY + 45, { width: 455 });
    document.text(`Risk posture: ${safeText(input.riskTolerance)}`, 68, summaryY + 66, { width: 455 });
    document.y = summaryY + 140;
    section(document, 'Executive summary', input.purpose);
    if (input.investorProfile) {
      const profile = input.investorProfile;
      section(document, 'Confirmed investor profile', `Score ${profile.score}/75 - ${profile.category}. Suggested general guide: ${profile.suggestedAllocation.stocks}% stocks / ${profile.suggestedAllocation.bonds}% bonds. Confirmed ${profile.confirmedAt.slice(0, 10)}.`);
      section(document, 'Strategy scope', profile.confirmation.scope === 'equity_sleeve'
        ? 'Equity sleeve within a broader portfolio. The bond portion is outside automated equity research. Sleeve allocations are not whole-portfolio weights.'
        : `Investor-requested full-equity strategy. ${profile.confirmation.deviationReason || 'The guide suggests 100% stocks; this is not a suitability certification.'}`);
      if (profile.warnings.length) bulletList(document, profile.warnings.map(code => profileWarningText(code, 'en')), '');
    }
    section(document, 'Investment thesis', 'This document records the investor’s objectives and decision rules. It is a mandate for subsequent research and human review; it is not a security recommendation.');
    section(document, 'Portfolio destinations');
    bulletList(document, input.mandates.map((mandate) => `${mandate.label} (${mandate.currency}) — ${mandate.objective}`), 'No portfolio destination was specified.');
    document.moveDown(1.4).fillColor(MUTED).fontSize(8.5).text('Strategy intake uses investor-provided information. No external issuer or market facts, forecasts, target prices or valuations are asserted in this document.', { width: 495, lineGap: 2 });

    document.addPage();
    document.fillColor(GREEN).font('Helvetica-Bold').fontSize(18).text('Selection policy and risk framework');
    document.moveDown(0.25).fillColor(MUTED).font('Helvetica').fontSize(9.5).text('The detailed rules below preserve what you stated. Missing information remains unspecified; research must not treat missing data as proof that a company qualifies.');

    for (const mandate of input.mandates) {
      document.moveDown(0.8).fillColor(GREEN).font('Helvetica-Bold').fontSize(13).text(safeText(mandate.label));
      document.moveDown(0.2).fillColor(MUTED).font('Helvetica').fontSize(9.5).text(`Role: ${safeText(mandate.role)}   ·   Reporting currency: ${safeText(mandate.currency)}`);
      section(document, 'Mandate objective', mandate.objective);
      section(document, 'Investment approach and valuation', mandate.policy?.strategy);
      section(document, 'Eligible universe');
      bulletList(document, policyLines(mandate.policy), 'No structured geography or security restrictions were specified.');
      section(document, 'What qualifies');
      bulletList(document, mandate.inclusionCriteria, 'No additional inclusion criteria specified.');
      section(document, 'What disqualifies');
      bulletList(document, mandate.exclusionCriteria, 'No additional exclusions specified.');
      section(document, 'Classified rules');
      bulletList(document, ruleLines(mandate.policy), 'No additional classified rules specified.');
      const riskDebates = (mandate.policy?.rules ?? []).filter((rule) => rule.category === 'risk' || rule.category === 'macro');
      section(document, 'Key risks and monitoring focus');
      bulletList(document, riskDebates.map((rule) => `${rule.kind === 'hard' ? 'Requirement' : rule.kind === 'preference' ? 'Watch item' : 'Context'}: ${rule.statement}`), 'No specific risk or macro monitor was provided. Research must identify material risks before investment review.');
      const holdings = [
        mandate.policy?.targetHoldings ? `Target holdings: ${mandate.policy.targetHoldings}` : '',
        mandate.policy?.maximumHoldings ? `Maximum holdings: ${mandate.policy.maximumHoldings}` : '',
        mandate.policy?.benchmark ? `Benchmark: ${mandate.policy.benchmark}` : '',
      ].filter(Boolean);
      if (holdings.length) section(document, 'Portfolio construction', holdings.join('\n'));
    }

    if (input.investorProfile) {
      section(document, 'Investor questionnaire - answer and scoring record');
      bulletList(document, input.investorProfile.breakdown.map(answer => {
        const question = INVESTOR_QUESTIONS.find(q => q.id === answer.id)!;
        return `${answer.question}. ${question.question} Answer ${answer.answer}: ${question.options[answer.answer.charCodeAt(0) - 65]}. ${answer.points} points.`;
      }), '');
      section(document, 'Profile source and limitations', 'Adapted from Vanguard Investor Questionnaire (2022), questions pp. 4-5, scoring p. 6, allocation guide p. 7. Answer order, point allocations and score bands are preserved. This framework uses U.S. stock/bond assumptions and is a general guide, not comprehensive investment advice or a Brazilian suitability certification. It excludes other asset classes, taxes, full household circumstances and external holdings. Bonds can also lose value. Reassess when circumstances or assumptions change.');
    }
    section(document, 'Portfolio-wide constraints');
    bulletList(document, input.globalConstraints, 'No additional portfolio-wide constraint was specified.');
    section(document, 'Governance and decision protocol', `Review cadence: ${input.reviewCadence}. Material changes to the objectives, time horizon, risk capacity, liquidity needs or portfolio constraints should be reviewed and recorded as a new version. Every security requires evidence-based human approval before it enters the portfolio.`);
    section(document, 'Evidence and limitations', 'Qualitative preferences guide analysis unless explicitly defined as hard requirements. Numeric tests are used only where the investor supplied a threshold, unit and period. Source coverage and data quality must be disclosed during research; unavailable evidence does not establish eligibility. Automated market discovery currently covers B3 (BVMF) and SIX (XSWX).');
    document.moveDown(1).fillColor(MUTED).font('Helvetica').fontSize(8.5).text('Generated by Portfolio Creator in Portfolio Intelligence from the investor’s confirmed profile and strategy conversation. This mandate is for research planning and does not constitute investment advice, an offer, or an instruction to transact.', { width: 495, lineGap: 2 });
    document.end();
  });
}

export function generatedThesisFileName(title: string): string {
  const stem = safeText(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80) || 'investment-thesis';
  return `${stem}-investment-thesis.pdf`;
}

export function thesisCriteriaToPdfInput(criteria: ThesisCriteria, investorName = ''): GeneratedThesisInput {
  const first = criteria.portfolios[0];
  const roleNames: Record<string, string> = { swiss_quality: 'Swiss Quality', brazilian_growth: 'Brazilian Growth' };
  const markets = [...new Set(criteria.portfolios.flatMap((portfolio) => portfolio.policy?.universe.listingMarkets ?? []))];
  const constraints = [...criteria.globalConstraints];
  const takeConstraint = (prefix: string) => {
    const index = constraints.findIndex((value) => value.startsWith(prefix));
    if (index < 0) return '';
    return constraints.splice(index, 1)[0]!.slice(prefix.length).trim();
  };
  const riskTolerance = takeConstraint('Risk posture:');
  const reviewCadence = takeConstraint('Review cadence:') || 'As needed';
  return {
    title: strategyPdfTitleFromCriteria(criteria),
    investorName,
    purpose: criteria.portfolios.map((portfolio) => portfolio.objective).join('\n\n'),
    timeHorizon: first?.policy?.horizon || 'Not specified',
    riskTolerance: riskTolerance || 'Not specified',
    markets: markets.length ? markets : ['Not specified'],
    globalConstraints: constraints,
    reviewCadence,
    mandates: criteria.portfolios.map((portfolio) => ({
      role: portfolio.role,
      label: portfolio.policy?.name || roleNames[portfolio.role] || portfolio.role.replaceAll('_', ' '),
      currency: portfolio.currency,
      objective: portfolio.objective,
      inclusionCriteria: portfolio.inclusionCriteria,
      exclusionCriteria: portfolio.exclusionCriteria,
      policy: portfolio.policy,
    })),
  };
}
