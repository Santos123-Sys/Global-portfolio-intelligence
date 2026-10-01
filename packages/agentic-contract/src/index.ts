import { MarketProfile, MarketContext, MarketAnalysis, buildMarketPlan, marketContextFromRecord } from './market-adaptive.js';
export * from './market-adaptive.js';
export * from './market-engines.js';
import { z } from 'zod';
import { runtimePolicySchema } from './agent-governance.js';
export * from './agent-governance.js';
import { ThesisPolicy } from './thesis-policy.js';
import { evaluateThesisEligibility } from './thesis-domain.js';
import { DiscoveryContext, ScreeningAudit, screenDiscoveryUniverse, issuerKey } from './discovery-domain.js';
export { DiscoveryContext, ScreeningAudit, screenDiscoveryUniverse, issuerKey, listingKey, discoveryMarkets } from './discovery-domain.js';
export { ThesisPolicy, ThesisRule, emptyThesisPolicy } from './thesis-policy.js';
export { reviewStructuredThesis, thesisDiscoveryPlan, evaluateThesisEligibility, diffThesis } from './thesis-domain.js';

export {
  AGENT_REASONING_PROMPT_VERSION,
  AGENT_REASONING_PROMPTS,
  DETERMINISTIC_ENGINE_POLICIES,
  type AgentReasoningPrompt,
  type DeterministicEnginePolicy,
} from './prompt-presets.js';

export const MANIFEST_SCHEMA_VERSION = '1.0' as const;

export const PortfolioRole = z.enum([
  'swiss_quality',
  'brazilian_growth',
  'fixed_income',
  'not_suitable',
]);
export type PortfolioRole = z.infer<typeof PortfolioRole>;

/**
 * A thesis may contain sleeves beyond the equity universes currently covered
 * by discovery providers. Keep that source-authored mandate intact at the
 * thesis layer; downstream discovery remains deliberately bounded.
 */
export const ThesisPortfolioRole = z.string().trim().min(2).max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Portfolio role must use lowercase snake_case');
export type ThesisPortfolioRole = z.infer<typeof ThesisPortfolioRole>;

export const AgentKind = z.enum([
  'thesis_extraction',
  'market_research',
  'security_analysis',
  'portfolio_synthesis',
]);
export type AgentKind = z.infer<typeof AgentKind>;

export const AgentTool = z.enum([
  'thesis_document',
  'structured_universe',
  'web_search',
  'grounding_bundle',
]);
export type AgentTool = z.infer<typeof AgentTool>;

/**
 * Owner-configurable instructions are always appended to immutable service
 * policy. They can narrow an agent's scope, but cannot remove grounding,
 * calculation, ownership, or no-trading constraints.
 */
export const AgentCustomization = z.object({
  agentKind: AgentKind,
  configVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  scope: z.string().trim().min(1).max(2_000),
  promptAddendum: z.string().trim().max(4_000),
  enabledTools: z.array(AgentTool).max(4),
  runtimePolicy: runtimePolicySchema.optional(),
  configurationHash: z.string().optional(),
}).strict();
export type AgentCustomization = z.infer<typeof AgentCustomization>;

const score = z.number().int().min(0).max(100);

/**
 * The decision-oriented research map that sits between a discovery shortlist
 * and a valuation model. It makes the analyst's reasoning visible without
 * pretending incomplete evidence supports a full financial forecast.
 */
export const ResearchFramework = z.object({
  coverageRationale: z.string().min(1),
  marketContext: z.array(z.string()),
  sectorDrivers: z.array(z.string()),
  companyDrivers: z.array(z.string()),
  criticalValuationDrivers: z.array(z.string()),
  monitoringTriggers: z.array(z.string()).min(1),
  evidenceQuality: z.enum(['limited', 'developing', 'sufficient']),
  scenarioReadiness: z.enum(['not_ready', 'qualitative_only', 'driver_ready']),
}).strict();
export type ResearchFramework = z.infer<typeof ResearchFramework>;

export const ThesisPortfolioCriteria = z.object({
  role: ThesisPortfolioRole,
  currency: z.string().min(1),
  objective: z.string().min(1),
  inclusionCriteria: z.array(z.string()),
  exclusionCriteria: z.array(z.string()),
  targetMetrics: z.record(z.string(), z.string()).optional(),
  policy: ThesisPolicy.optional(),
}).strict();

export const ThesisCriteria = z.object({
  version: z.number().int().positive(),
  portfolios: z.array(ThesisPortfolioCriteria).min(1),
  globalConstraints: z.array(z.string()),
}).strict();
export type ThesisCriteria = z.infer<typeof ThesisCriteria>;

export const ThesisExtractionResult = z.object({
  criteria: ThesisCriteria,
  extractionConfidence: z.number().min(0).max(1),
  ambiguousPoints: z.array(z.object({
    location: z.string(),
    issue: z.string(),
    sourceExcerpt: z.string(),
  })),
  unmappedContent: z.array(z.string()),
}).strict();
export type ThesisExtractionResult = z.infer<typeof ThesisExtractionResult>;

export const AnalysisOutput = z.object({
  marketAnalysis: MarketAnalysis.optional(),
  ticker: z.string().min(1),
  companyName: z.string().min(1),
  portfolioCandidate: z.boolean(),
  portfolioRole: PortfolioRole,
  investmentScore: score,
  thesisAlignmentScore: score,
  qualityScore: score,
  growthScore: score,
  riskScore: score,
  dividendScore: score,
  fundamentalSummary: z.string().min(1),
  investmentThesis: z.string().min(1),
  keyCatalysts: z.array(z.string()).min(1),
  keyRisks: z.array(z.string()).min(1),
  thesisBreakers: z.array(z.string()),
  confidenceScore: z.number().min(0).max(1),
  researchFramework: ResearchFramework,
  groundedIn: z.array(z.string()).min(1),
  informationGaps: z.array(z.string()),
}).strict();
export type AnalysisOutput = z.infer<typeof AnalysisOutput>;
/** Only this schema is model-authored; the execution report is attached by the service. */
export const AnalysisModelOutput = AnalysisOutput.omit({ marketAnalysis: true });

export const AnalysisDataMode = z.enum([
  'full_fundamentals',
  'limited_research_risk',
]);
export type AnalysisDataMode = z.infer<typeof AnalysisDataMode>;

export const GroundingBundle = z.object({
  marketContext: MarketContext.optional(),
  marketProfiles: z.array(MarketProfile).min(1).optional(),
  ticker: z.string().min(1),
  companyName: z.string().min(1),
  exchange: z.string().min(1),
  currency: z.string().min(1),
  sector: z.string().nullable(),
  country: z.string().nullable(),
  computedMetrics: z.record(z.string(), z.number()),
  dataAsOf: z.string().datetime(),
  fundamentals: z.record(z.string(), z.union([z.number(), z.string(), z.null()])),
  analysisMode: AnalysisDataMode.optional(),
  researchEvidence: z.record(z.string(), z.string()).optional(),
}).strict().superRefine((bundle, context) => {
  if (bundle.analysisMode !== 'limited_research_risk') return;
  if (Object.keys(bundle.fundamentals).length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fundamentals'],
      message: 'Limited research-and-risk analysis cannot contain structured fundamentals',
    });
  }
  if (Object.keys(bundle.researchEvidence ?? {}).length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['researchEvidence'],
      message: 'Limited research-and-risk analysis requires source-backed research evidence',
    });
  }
});
export type GroundingBundle = z.infer<typeof GroundingBundle>;

export const ReportSynthesisOutput = z.object({
  executiveSummary: z.string().min(1),
  thematicHighlights: z.array(z.string()),
  concentrationFlags: z.array(z.string()),
  perSecurityNarratives: z.array(z.object({
    ticker: z.string().min(1),
    narrative: z.string().min(1),
  })),
  watchlistAndViolations: z.array(z.string()),
  disclaimer: z.string().min(1),
  groundedIn: z.array(z.string()).min(1),
}).strict();
export type ReportSynthesisOutput = z.infer<typeof ReportSynthesisOutput>;

/** Reader-facing evidence projected from the validated grounding bundle. */
export const ReportEvidence = z.object({
  ticker: z.string().min(1),
  exchange: z.string().min(1),
  currency: z.string().min(1),
  sector: z.string().nullable(),
  country: z.string().nullable(),
  dataAsOf: z.string().datetime(),
  analysisMode: AnalysisDataMode.optional(),
  latestClose: z.number().finite().optional(),
  riskMetrics: z.array(z.object({
    name: z.string().min(1),
    value: z.number().finite(),
  }).strict()),
  sourceUrls: z.array(z.string().url()),
}).strict();
export type ReportEvidence = z.infer<typeof ReportEvidence>;

export const PortfolioManifest = z.object({
  portfolioId: z.string().uuid(),
  name: z.string().min(1),
  baseCurrency: z.string().min(1),
  analyses: z.array(AnalysisOutput).min(1),
  synthesis: ReportSynthesisOutput,
  evidence: z.array(ReportEvidence).optional(),
}).strict();

export const PortfolioAnalysisManifest = z.object({
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  /** Bound by the dashboard when the run is created; never inferred on import. */
  accountId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  thesisVersion: z.number().int().positive(),
  portfolios: z.array(PortfolioManifest).min(1),
}).strict();
export type PortfolioAnalysisManifest = z.infer<typeof PortfolioAnalysisManifest>;

export const AgenticRunRequest = z.object({
  /** The dashboard-selected account receiving this run. */
  accountId: z.string().uuid(),
  thesis: z.object({
    versionId: z.string().uuid(),
    criteria: ThesisCriteria,
  }),
  securities: z.array(z.object({
    ticker: z.string().min(1),
    exchange: z.string().min(1),
    portfolioId: z.string().uuid(),
  })).min(1),
  portfolios: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    baseCurrency: z.string().min(1),
    investmentObjective: z.string(),
  })).min(1),
  groundingBundles: z.array(z.object({
    portfolioId: z.string().uuid(),
    bundle: GroundingBundle,
  })).min(1),
  origin: z.object({
    kind: z.enum(['portfolio_monitoring', 'discovery_candidate']),
    candidateId: z.string().uuid().optional(),
  }).strict().optional(),
  agentConfigs: z.array(AgentCustomization).max(2).optional(),
}).strict().superRefine((request, context) => {
  if (request.origin?.kind === 'discovery_candidate' && !request.origin.candidateId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['origin', 'candidateId'],
      message: 'Discovery-candidate analysis requires candidateId',
    });
  }
  const allowed = new Set(['security_analysis', 'portfolio_synthesis']);
  if (request.agentConfigs?.some((config) => !allowed.has(config.agentKind))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['agentConfigs'],
      message: 'Analysis runs accept only security_analysis and portfolio_synthesis configurations',
    });
  }
});
export type AgenticRunRequest = z.infer<typeof AgenticRunRequest>;

const universeScalar = z.union([z.number().finite(), z.string(), z.boolean(), z.null()]);

export const SecurityUniverseRecord = z.object({
  ticker: z.string().trim().min(1),
  exchange: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  currency: z.string().trim().min(1),
  country: z.string().nullable(),
  sector: z.string().nullable(),
  industry: z.string().nullable(),
  assetType: z.string().trim().min(1),
  observedAt: z.string().datetime(),
  provider: z.string().trim().min(1),
  sourceUrl: z.string().url(),
  attributes: z.record(z.string(), universeScalar),
}).strict();
export type SecurityUniverseRecord = z.infer<typeof SecurityUniverseRecord>;

export const DiscoveryRunRequest = z.object({
  dispatchId: z.string().uuid().optional(),
  thesis: z.object({
    versionId: z.string().uuid(),
    criteria: ThesisCriteria,
  }).strict(),
  portfolios: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1),
    role: PortfolioRole.exclude(['not_suitable']),
    baseCurrency: z.string().trim().min(1),
    investmentObjective: z.string(),
  }).strict()).min(1),
  universe: z.array(SecurityUniverseRecord).min(1).max(10000),
  researchBudgetPerPortfolio: z.number().int().min(1).max(100).optional(),
  universeFailures: z.array(z.object({ exchange: z.string(), reason: z.string() }).strict()).optional(),
  knownSecurities: z.array(z.object({
    portfolioId: z.string().uuid(), ticker: z.string(), exchange: z.string(),
    issuerKey: z.string().optional(), reason: z.enum(['held', 'under_review', 'under_analysis', 'rejected']),
    thesisVersionId: z.string().uuid().optional(),
  }).strict()).optional(),
  maxCandidatesPerPortfolio: z.number().int().min(1).max(20).default(8),
  agentConfig: AgentCustomization.optional(),
}).strict().superRefine((request, context) => {
  if (request.agentConfig && request.agentConfig.agentKind !== 'market_research') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['agentConfig', 'agentKind'],
      message: 'Discovery runs accept only a market_research configuration',
    });
  }
});
export type DiscoveryRunRequest = z.infer<typeof DiscoveryRunRequest>;

export const DiscoveryCandidate = z.object({
  discoveryContext: DiscoveryContext.optional(),
  portfolioId: z.string().uuid(),
  ticker: z.string().trim().min(1),
  exchange: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  currency: z.string().trim().min(1),
  country: z.string().nullable(),
  sector: z.string().nullable(),
  industry: z.string().nullable().default(null),
  /** Provider classification is authoritative; web research is labelled as such. */
  classificationSource: z.enum(['provider', 'web_research', 'unclassified']).default('unclassified'),
  thesisAlignmentScore: score,
  rationale: z.string().trim().min(1),
  matchedCriteria: z.array(z.string()),
  violatedCriteria: z.array(z.string()),
  groundedIn: z.array(z.string()).min(1),
  sourceUrls: z.array(z.string().url()).min(1),
  informationGaps: z.array(z.string()),
}).strict();
export type DiscoveryCandidate = z.infer<typeof DiscoveryCandidate>;

export const MarketDiscoveryOutput = z.object({
  screeningAudit: ScreeningAudit.optional(),
  thesisVersion: z.number().int().positive(),
  marketMandates: z.array(z.object({
    portfolioId: z.string().uuid(),
    role: PortfolioRole.exclude(['not_suitable']),
    exchanges: z.array(z.string().min(1)).min(1),
    currency: z.string().min(1),
    rationale: z.string().min(1),
  }).strict()).min(1),
  candidates: z.array(DiscoveryCandidate),
  /** URLs copied by the service from actual web-search tool metadata, never model-authored. */
  verifiedWebSources: z.array(z.string().url()),
  limitations: z.array(z.string()),
  /** One explicit outcome for every requested portfolio, including empty and failed markets. */
  portfolioOutcomes: z.array(z.object({
    portfolioId: z.string().uuid(),
    status: z.enum(['candidates_found', 'no_candidates', 'failed']),
    reason: z.string().trim().min(1),
  }).strict()).optional(),
}).strict();
export type MarketDiscoveryOutput = z.infer<typeof MarketDiscoveryOutput>;

/** Source-backed market research is reviewed before it can continue into financial analysis. */
export const MarketBriefRequest = z.object({
  dispatchId: z.string().uuid().optional(),
  thesisVersionId: z.string().uuid(),
  candidateId: z.string().uuid(),
  thesis: ThesisCriteria,
  security: z.object({
    ticker: z.string().trim().min(1),
    exchange: z.string().trim().min(1),
    companyName: z.string().trim().min(1),
    currency: z.string().trim().min(1),
    country: z.string().nullable(),
    sector: z.string().nullable(),
    industry: z.string().nullable(),
  }).strict(),
  marketContext: MarketContext.optional(),
  discoveryEvidence: z.object({
    rationale: z.string().min(1),
    matchedCriteria: z.array(z.string()),
    violatedCriteria: z.array(z.string()),
    informationGaps: z.array(z.string()),
    sourceUrls: z.array(z.string().url()),
  }).strict(),
}).strict();
export type MarketBriefRequest = z.infer<typeof MarketBriefRequest>;

export const MarketBriefEvidence = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.string().url(),
  sourceKind: z.enum(['regulatory_filing', 'official_statistics', 'issuer', 'market_data', 'research', 'other']),
  publishedAt: z.string().nullable(),
  retrievedAt: z.string().datetime(),
  supports: z.array(z.string()),
  excerpt: z.string().min(1),
}).strict();

const marketBriefClaim = z.object({
  statement: z.string().min(1),
  evidenceRefs: z.array(z.string()).min(1),
  confidence: z.enum(['low', 'medium', 'high']),
}).strict();

export const MarketBrief = z.object({
  schemaVersion: z.literal('1.0'),
  security: z.object({ ticker: z.string(), exchange: z.string(), companyName: z.string() }).strict(),
  executiveSummary: z.string().min(1),
  marketDefinition: z.object({
    industry: z.string().min(1),
    productScope: z.string().min(1),
    geography: z.string().min(1),
    period: z.string().min(1),
    assumptions: z.array(z.string()),
  }).strict(),
  marketSizing: z.array(z.object({
    measure: z.enum(['TAM', 'SAM', 'SOM']),
    value: z.string().min(1),
    methodology: z.string().min(1),
    claim: marketBriefClaim,
  }).strict()),
  macroAndPolicy: z.array(marketBriefClaim),
  valueChain: z.array(marketBriefClaim),
  demandAndCustomers: z.array(marketBriefClaim),
  goToMarketAndChannels: z.array(marketBriefClaim),
  competitiveLandscape: z.array(marketBriefClaim),
  companyPositioning: z.array(marketBriefClaim),
  thesisFit: z.object({ alignment: z.array(marketBriefClaim), tensions: z.array(marketBriefClaim) }).strict(),
  monitoringQuestions: z.array(z.string()),
  evidenceRegister: z.array(MarketBriefEvidence),
  confidence: z.enum(['limited', 'developing', 'sufficient']),
  informationGaps: z.array(z.string()),
  generatedAt: z.string().datetime(),
}).strict();
export type MarketBrief = z.infer<typeof MarketBrief>;

export const MarketBriefModelOutput = MarketBrief.omit({ generatedAt: true, evidenceRegister: true, security: true, schemaVersion: true });

export const MarketBriefStatus = z.object({
  externalMarketBriefId: z.string().min(1),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  progress: z.object({ completed: z.number().int().nonnegative(), total: z.number().int().nonnegative(), currentStage: z.string() }).strict().optional(),
  result: MarketBrief.optional(),
  errorMessage: z.string().min(1).optional(),
  updatedAt: z.string().datetime(),
}).strict();
export type MarketBriefStatus = z.infer<typeof MarketBriefStatus>;

export const DiscoveryRunStatus = z.object({
  externalDiscoveryId: z.string().min(1),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  progress: z.object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    currentStage: z.string(),
  }).strict().optional(),
  result: MarketDiscoveryOutput.optional(),
  errorMessage: z.string().min(1).optional(),
  updatedAt: z.string().datetime(),
}).strict();
export type DiscoveryRunStatus = z.infer<typeof DiscoveryRunStatus>;

export const AgenticRunSelection = z.object({
  thesisVersionId: z.string().uuid().optional(),
  portfolioIds: z.array(z.string().uuid()).min(1).optional(),
}).strict();
export type AgenticRunSelection = z.infer<typeof AgenticRunSelection>;

export const ExternalRunStatus = z.object({
  externalRunId: z.string().min(1),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  progress: z.object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    currentStage: z.string(),
  }).optional(),
  manifest: PortfolioAnalysisManifest.optional(),
  reportPdfUrl: z.string().url().optional(),
  errorMessage: z.string().min(1).optional(),
  updatedAt: z.string().datetime(),
}).strict();
export type ExternalRunStatus = z.infer<typeof ExternalRunStatus>;

export const FailedStage = z.enum([
  'extraction',
  'analysis',
  'synthesis',
  'render',
  'upload',
  'callback',
]);
export type FailedStage = z.infer<typeof FailedStage>;

export const AgenticImportRequest = z.discriminatedUnion('status', [
  z.object({
    externalRunId: z.string().min(1),
    status: z.literal('completed'),
    manifest: PortfolioAnalysisManifest,
    reportPdfUrl: z.string().url().optional(),
  }).strict(),
  z.object({
    externalRunId: z.string().min(1),
    status: z.literal('failed'),
    errorMessage: z.string().min(1),
    failedStage: FailedStage.optional(),
  }).strict(),
]);
export type AgenticImportRequest = z.infer<typeof AgenticImportRequest>;

export const MAX_THESIS_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_THESIS_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_THESIS_BASE64_CHARACTERS = Math.ceil(MAX_THESIS_PDF_BYTES / 3) * 4 + 4;

export const ThesisDocument = z.object({
  version: z.number().int().positive(),
  fileName: z.string().trim().min(1).max(255).refine(
    (value) => !/[\u0000-\u001f\u007f/\\]/.test(value),
    'Document filename contains forbidden characters'
  ),
  mimeType: z.enum(['application/pdf', 'text/plain', 'text/markdown']),
  contentBase64: z.string().min(1).max(MAX_THESIS_BASE64_CHARACTERS),
}).strict();
export type ThesisDocument = z.infer<typeof ThesisDocument>;

export const ThesisExtractionRequest = z.object({
  document: ThesisDocument,
  agentConfig: AgentCustomization.optional(),
}).strict().superRefine((request, context) => {
  if (request.agentConfig && request.agentConfig.agentKind !== 'thesis_extraction') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['agentConfig', 'agentKind'],
      message: 'Thesis extraction accepts only a thesis_extraction configuration',
    });
  }
});
export type ThesisExtractionRequest = z.infer<typeof ThesisExtractionRequest>;

export const ThesisExtractionStatus = z.object({
  externalExtractionId: z.string().min(1),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  result: ThesisExtractionResult.optional(),
  errorMessage: z.string().min(1).optional(),
  updatedAt: z.string().datetime(),
}).strict();
export type ThesisExtractionStatus = z.infer<typeof ThesisExtractionStatus>;

export class ContractValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractValidationError';
  }
}

export function validateInvestmentScoreGate(output: AnalysisOutput): void {
  if (output.thesisAlignmentScore < 45) {
    const ceiling = output.thesisAlignmentScore + 15;
    if (output.investmentScore > ceiling) {
      throw new ContractValidationError(
        `Thesis-alignment gate violated: investmentScore must be <= ${ceiling}`
      );
    }
  }
}

export function validateAnalysisSemantics(output: AnalysisOutput): void {
  validateInvestmentScoreGate(output);
  if (output.portfolioRole === 'not_suitable' && output.portfolioCandidate) {
    throw new ContractValidationError('not_suitable analyses cannot be portfolio candidates');
  }
  if (!/affirmative case\s*:/i.test(output.investmentThesis) ||
      !/strongest counter-case\s*:/i.test(output.investmentThesis)) {
    throw new ContractValidationError(
      'investmentThesis must label both "Affirmative case:" and "Strongest counter-case:"'
    );
  }
  if (output.researchFramework.scenarioReadiness === 'driver_ready' && output.informationGaps.some((gap) => /structured financial statements unavailable|dcf locked/i.test(gap))) {
    throw new ContractValidationError(
      'driver_ready scenarios require structured financial statements; use qualitative_only or not_ready'
    );
  }
}

export function validateGrounding(output: AnalysisOutput, bundle: GroundingBundle): void {
  if (output.marketAnalysis) {
    const expected = buildMarketPlan(bundle.marketContext ?? marketContextFromRecord(bundle), bundle.marketProfiles);
    if (stableStringify(output.marketAnalysis.plan) !== stableStringify(expected)) throw new ContractValidationError('Market plan does not match the approved grounding context');
    const refs = new Set([...Object.keys(bundle.fundamentals), ...Object.keys(bundle.computedMetrics), ...Object.keys(bundle.researchEvidence ?? {}), ...Object.keys(expected.context.sourceReferences).map(k => `market:${k}`)]);
    if (output.marketAnalysis.executions.map(e => e.agent).join('|') !== expected.nodes.map(n => n.id).join('|')) throw new ContractValidationError('Market module execution coverage is incomplete');
    for (const execution of output.marketAnalysis.executions) for (const finding of [...(execution.finding?.claims ?? []), ...(execution.finding?.risks ?? [])])
      if (finding.evidenceRefs.some(ref => !refs.has(ref))) throw new ContractValidationError('Market module contains an unknown evidence reference');
  }
  const available = new Set([
    ...Object.keys(bundle.computedMetrics),
    ...Object.keys(bundle.fundamentals),
    ...Object.keys(bundle.researchEvidence ?? {}),
  ]);
  if (available.size === 0) {
    throw new ContractValidationError(`No grounding was supplied for ${bundle.ticker}`);
  }
  const fabricated = output.groundedIn.filter((reference) => !available.has(reference));
  if (fabricated.length > 0) {
    throw new ContractValidationError(
      `Grounding validation failed for ${bundle.ticker}: ${fabricated.join(', ')}`
    );
  }
}

export function validateSynthesisCoverage(
  synthesis: ReportSynthesisOutput,
  analyses: AnalysisOutput[]
): void {
  const input = analyses.map((analysis) => analysis.ticker);
  const narratives = synthesis.perSecurityNarratives.map((item) => item.ticker);
  if (new Set(input).size !== input.length) {
    throw new ContractValidationError('Analysis tickers must be unique within a portfolio');
  }
  if (new Set(narratives).size !== narratives.length) {
    throw new ContractValidationError('Synthesis narratives must cover each ticker exactly once');
  }
  const inputSet = new Set(input);
  const missing = input.filter((ticker) => !narratives.includes(ticker));
  const extra = narratives.filter((ticker) => !inputSet.has(ticker));
  const fabricatedGrounding = synthesis.groundedIn.filter((ticker) => !inputSet.has(ticker));
  if (missing.length || extra.length || fabricatedGrounding.length) {
    throw new ContractValidationError(
      `Synthesis coverage invalid (missing=${missing.join(',')}; extra=${extra.join(',')}; grounding=${fabricatedGrounding.join(',')})`
    );
  }
}

export function validateRunRequestCoherence(request: AgenticRunRequest): void {
  const portfolioIds = request.portfolios.map((portfolio) => portfolio.id);
  if (new Set(portfolioIds).size !== portfolioIds.length) {
    throw new ContractValidationError('Portfolio IDs must be unique');
  }
  const allowedPortfolios = new Set(portfolioIds);
  const securityKeys = request.securities.map(
    (security) => `${security.portfolioId}:${security.exchange}:${security.ticker}`
  );
  const outputKeys = request.securities.map(
    (security) => `${security.portfolioId}:${security.ticker}`
  );
  if (new Set(securityKeys).size !== securityKeys.length || new Set(outputKeys).size !== outputKeys.length) {
    throw new ContractValidationError('Securities must be unique by portfolio and ticker');
  }
  if (request.securities.some((security) => !allowedPortfolios.has(security.portfolioId))) {
    throw new ContractValidationError('Every security must reference a supplied portfolio');
  }
  const groundingKeys = request.groundingBundles.map(
    ({ portfolioId, bundle }) => `${portfolioId}:${bundle.exchange}:${bundle.ticker}`
  );
  if (new Set(groundingKeys).size !== groundingKeys.length) {
    throw new ContractValidationError('Grounding bundles must be unique');
  }
  const requested = new Set(securityKeys);
  if (groundingKeys.length !== securityKeys.length || groundingKeys.some((key) => !requested.has(key))) {
    throw new ContractValidationError('Every requested security must have exactly one grounding bundle');
  }
}

export function universeGroundingKeys(record: SecurityUniverseRecord): string[] {
  return [
    'identity:ticker',
    'identity:exchange',
    'identity:companyName',
    'identity:currency',
    ...(record.country ? ['identity:country'] : []),
    ...(record.sector ? ['identity:sector'] : []),
    ...(record.industry ? ['identity:industry'] : []),
    ...Object.keys(record.attributes).map((key) => `attribute:${key}`),
  ];
}

function universeSourceUrls(record: SecurityUniverseRecord): Set<string> {
  const attributeUrls = Object.entries(record.attributes).flatMap(([key, value]) =>
    key.endsWith('_source_url') && typeof value === 'string' && /^https?:\/\//i.test(value)
      ? [value]
      : []
  );
  return new Set([record.sourceUrl, ...attributeUrls]);
}

export function validateDiscoveryOutput(
  output: MarketDiscoveryOutput,
  request: DiscoveryRunRequest
): void {
  if (output.thesisVersion !== request.thesis.criteria.version) {
    throw new ContractValidationError('Discovery output thesis version does not match the confirmed thesis');
  }

  const portfoliosById = new Map(request.portfolios.map((portfolio) => [portfolio.id, portfolio]));
  if (output.marketMandates.length !== portfoliosById.size) {
    throw new ContractValidationError('Discovery output must include one market mandate per portfolio');
  }
  const mandateIds = output.marketMandates.map((mandate) => mandate.portfolioId);
  if (new Set(mandateIds).size !== mandateIds.length || mandateIds.some((id) => !portfoliosById.has(id))) {
    throw new ContractValidationError('Discovery market mandates contain an unknown or duplicate portfolio');
  }
  if (output.portfolioOutcomes) {
    const outcomeIds = output.portfolioOutcomes.map((outcome) => outcome.portfolioId);
    if (outcomeIds.length !== portfoliosById.size || new Set(outcomeIds).size !== outcomeIds.length ||
      outcomeIds.some((id) => !portfoliosById.has(id))) {
      throw new ContractValidationError('Discovery outcomes must cover each requested portfolio exactly once');
    }
    for (const outcome of output.portfolioOutcomes) {
      const count = output.candidates.filter((candidate) => candidate.portfolioId === outcome.portfolioId).length;
      if ((outcome.status === 'candidates_found') !== (count > 0)) {
        throw new ContractValidationError('Discovery outcome disagrees with the portfolio candidate count');
      }
    }
  }
  const universeExchanges = new Set([...request.universe.map((record) => record.exchange), ...(request.universeFailures ?? []).map(f => f.exchange)]);
  const mandatesByPortfolio = new Map(output.marketMandates.map((mandate) => [mandate.portfolioId, mandate]));
  for (const mandate of output.marketMandates) {
    const portfolio = portfoliosById.get(mandate.portfolioId)!;
    if (mandate.role !== portfolio.role || mandate.currency !== portfolio.baseCurrency) {
      throw new ContractValidationError(`Discovery mandate changed portfolio identity for ${portfolio.id}`);
    }
    if (mandate.exchanges.some((exchange) => !universeExchanges.has(exchange))) {
      throw new ContractValidationError(`Discovery mandate introduced an exchange absent from the supplied universe`);
    }
  }

  const universe = new Map(request.universe.map((record) => [
    `${record.exchange}:${record.ticker}`,
    record,
  ]));
  const externallyRetrievedSources = new Set(output.verifiedWebSources);
  const screening = screenDiscoveryUniverse(request);
  if (output.screeningAudit && (output.screeningAudit.thesisVersionId !== request.thesis.versionId || JSON.stringify(output.screeningAudit.records) !== JSON.stringify(screening.records))) {
    throw new ContractValidationError('Screening audit disagrees with the saved request');
  }
  const seen = new Set<string>();
  const perPortfolio = new Map<string, number>();
  for (const candidate of output.candidates) {
    const portfolio = portfoliosById.get(candidate.portfolioId);
    if (!portfolio) throw new ContractValidationError(`Candidate references unknown portfolio ${candidate.portfolioId}`);
    const uniqueKey = `${candidate.portfolioId}:${candidate.exchange}:${candidate.ticker}`;
    if (seen.has(uniqueKey)) throw new ContractValidationError(`Duplicate discovery candidate ${uniqueKey}`);
    seen.add(uniqueKey);
    const count = (perPortfolio.get(candidate.portfolioId) ?? 0) + 1;
    perPortfolio.set(candidate.portfolioId, count);
    if (count > request.maxCandidatesPerPortfolio) {
      throw new ContractValidationError(`Too many candidates for portfolio ${candidate.portfolioId}`);
    }

    const record = universe.get(`${candidate.exchange}:${candidate.ticker}`);
    if (!record) throw new ContractValidationError(`Candidate ${candidate.ticker} is absent from the supplied universe`);
    const eligible = screening.eligibleByPortfolio.get(portfolio.id) ?? [];
    if (!eligible.some(r => r.exchange === record.exchange && r.ticker === record.ticker)) {
      throw new ContractValidationError(`Candidate ${candidate.ticker} is not eligible for this portfolio snapshot`);
    }
    if (candidate.discoveryContext && (JSON.stringify(candidate.discoveryContext.eligibility) !== JSON.stringify(screening.records.find(r => r.portfolioId === portfolio.id && r.ticker === record.ticker && r.exchange === record.exchange)) || candidate.discoveryContext.thesisVersionId !== request.thesis.versionId || candidate.discoveryContext.issuerKey !== issuerKey(record))) {
      throw new ContractValidationError('Candidate discovery context changed thesis or issuer identity');
    }
    const thesisMandate = request.thesis.criteria.portfolios.find(item => item.role === portfolio.role);
    if (thesisMandate && evaluateThesisEligibility(thesisMandate, record).status !== 'eligible') {
      throw new ContractValidationError(`Candidate ${candidate.ticker} has violated or unverified structured hard constraints`);
    }
    if (
      candidate.companyName !== record.companyName ||
      candidate.currency !== record.currency ||
      candidate.country !== record.country
    ) {
      throw new ContractValidationError(`Candidate identity changed for ${candidate.ticker}`);
    }

    const providerClassificationMatches =
      candidate.sector === record.sector &&
      candidate.industry === record.industry;
    const hasVerifiedWebClassificationSource = candidate.sourceUrls.some(
      (url) => url !== record.sourceUrl && externallyRetrievedSources.has(url)
    );
    const verifiedWebClassification =
      candidate.classificationSource === 'web_research' &&
      record.sector === null &&
      record.industry === null &&
      (candidate.sector !== null || candidate.industry !== null) &&
      hasVerifiedWebClassificationSource;
    if (!providerClassificationMatches && !verifiedWebClassification) {
      throw new ContractValidationError(
        `Candidate classification changed without verified evidence for ${candidate.ticker}`
      );
    }
    if (providerClassificationMatches && candidate.classificationSource === 'web_research') {
      throw new ContractValidationError(
        `Candidate classification source is inconsistent for ${candidate.ticker}`
      );
    }
    const mandate = mandatesByPortfolio.get(candidate.portfolioId)!;
    if (!mandate.exchanges.includes(candidate.exchange)) {
      throw new ContractValidationError(`Candidate ${candidate.ticker} does not match its portfolio market mandate`);
    }
    const availableGrounding = new Set(universeGroundingKeys(record));
    const fabricatedGrounding = candidate.groundedIn.filter((key) => !availableGrounding.has(key));
    if (fabricatedGrounding.length) {
      throw new ContractValidationError(
        `Discovery grounding failed for ${candidate.ticker}: ${fabricatedGrounding.join(', ')}`
      );
    }
    if (!candidate.sourceUrls.includes(record.sourceUrl)) {
      throw new ContractValidationError(`Candidate ${candidate.ticker} omitted its structured-universe source`);
    }
    const allowedRecordSources = universeSourceUrls(record);
    if (candidate.discoveryContext) {
      const candidateSources = new Set(candidate.discoveryContext.evidence.map(e => e.url));
      if (candidate.sourceUrls.some(url => !allowedRecordSources.has(url) && !candidateSources.has(url))) {
        throw new ContractValidationError(`Candidate ${candidate.ticker} cited another security's research evidence`);
      }
    }
    if (candidate.sourceUrls.some((url) => !allowedRecordSources.has(url) && !externallyRetrievedSources.has(url))) {
      throw new ContractValidationError(`Candidate ${candidate.ticker} cited a source absent from its universe record`);
    }
  }
}

export function validateManifestAgainstRequest(
  manifest: PortfolioAnalysisManifest,
  request: AgenticRunRequest
): void {
  if (manifest.accountId !== request.accountId) {
    throw new ContractValidationError('Manifest account does not match the run request');
  }
  if (manifest.thesisVersion !== request.thesis.criteria.version) {
    throw new ContractValidationError('Manifest thesis version does not match the run request');
  }
  const requestedPortfolios = new Map(request.portfolios.map((portfolio) => [portfolio.id, portfolio]));
  if (manifest.portfolios.length !== requestedPortfolios.size) {
    throw new ContractValidationError('Manifest must contain every requested portfolio exactly once');
  }
  const seenPortfolios = new Set<string>();
  for (const portfolio of manifest.portfolios) {
    const requestedPortfolio = requestedPortfolios.get(portfolio.portfolioId);
    if (!requestedPortfolio || seenPortfolios.has(portfolio.portfolioId)) {
      throw new ContractValidationError(`Unexpected or duplicate portfolio ${portfolio.portfolioId}`);
    }
    seenPortfolios.add(portfolio.portfolioId);
    if (portfolio.name !== requestedPortfolio.name || portfolio.baseCurrency !== requestedPortfolio.baseCurrency) {
      throw new ContractValidationError(`Portfolio metadata changed for ${portfolio.portfolioId}`);
    }
    const expected = request.securities
      .filter((security) => security.portfolioId === portfolio.portfolioId)
      .map((security) => security.ticker)
      .sort();
    const actual = portfolio.analyses.map((analysis) => analysis.ticker).sort();
    if (expected.length !== actual.length || expected.some((ticker, index) => ticker !== actual[index])) {
      throw new ContractValidationError(`Manifest security coverage changed for ${portfolio.portfolioId}`);
    }
    for (const output of portfolio.analyses) {
      validateAnalysisSemantics(output);
      const grounding = request.groundingBundles.find(
        (item) => item.portfolioId === portfolio.portfolioId && item.bundle.ticker === output.ticker
      );
      if (!grounding) throw new ContractValidationError(`Missing grounding for ${output.ticker}`);
      if (output.companyName !== grounding.bundle.companyName) {
        throw new ContractValidationError(`Company identity changed for ${output.ticker}`);
      }
      validateGrounding(output, grounding.bundle);
    }
    if (portfolio.evidence) {
      const expectedEvidence = new Map(request.groundingBundles
        .filter((item) => item.portfolioId === portfolio.portfolioId)
        .map((item) => [item.bundle.ticker, item.bundle]));
      if (portfolio.evidence.length !== expectedEvidence.size) {
        throw new ContractValidationError(`Manifest evidence coverage changed for ${portfolio.portfolioId}`);
      }
      for (const evidence of portfolio.evidence) {
        const bundle = expectedEvidence.get(evidence.ticker);
        if (!bundle || evidence.exchange !== bundle.exchange || evidence.currency !== bundle.currency) {
          throw new ContractValidationError(`Manifest evidence identity changed for ${evidence.ticker}`);
        }
        const allowedUrls = new Set(Object.values(bundle.researchEvidence ?? {})
          .flatMap((value) => value.split('|').map((item) => item.trim()))
          .filter((value) => /^https?:\/\//.test(value)));
        if (evidence.sourceUrls.some((url) => !allowedUrls.has(url))) {
          throw new ContractValidationError(`Manifest source URL was not grounded for ${evidence.ticker}`);
        }
      }
    }
    validateSynthesisCoverage(portfolio.synthesis, portfolio.analyses);
  }
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${stableStringify(record[key])}`
  ).join(',')}}`;
}
