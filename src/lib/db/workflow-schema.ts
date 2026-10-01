import { pgTable, uuid, text, timestamp, numeric, jsonb, index, uniqueIndex, integer, boolean, real, date, vector, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { accounts, aiAnalyses, portfolios, securities, thesisVersions, users } from './schema';

/**
 * A provider-independent, reusable discovery universe. This is not a source of
 * truth for valuation; it lets a temporarily unavailable discovery API fall
 * back to a known, dated universe rather than synthetic data.
 */
export const discoveryUniverseSnapshots = pgTable(
  'discovery_universe_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    exchange: text('exchange').notNull(),
    recordsJson: jsonb('records_json').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    providerExchangeIdx: uniqueIndex('discovery_universe_provider_exchange_idx').on(t.provider, t.exchange),
    expiryIdx: index('discovery_universe_expiry_idx').on(t.expiresAt),
  })
);

/**
 * Atomic external-data evidence. This table is deliberately metric-oriented so
 * the system can keep the source URL, retrieval query, status and raw payload
 * next to every market or fundamental value consumed by downstream logic.
 */
export const marketDataObservations = pgTable(
  'market_data_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    securityId: uuid('security_id').references(() => securities.id, { onDelete: 'cascade' }).notNull(),
    observationType: text('observation_type').notNull(), // price | fundamental | search_evidence
    metricName: text('metric_name').notNull(),
    valueNumeric: numeric('value_numeric', { precision: 24, scale: 10 }),
    valueText: text('value_text'),
    currency: text('currency'),
    observationDate: text('observation_date'),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).defaultNow().notNull(),
    provider: text('provider').notNull(),
    sourceName: text('source_name'),
    sourceUrl: text('source_url'),
    query: text('query'),
    status: text('status').notNull(), // OK | DATA_UNAVAILABLE | PARSE_UNCERTAIN | ERROR
    evidenceSnippet: text('evidence_snippet'),
    rawPayload: jsonb('raw_payload'),
  },
  (t) => ({
    securityMetricIdx: index('market_observations_security_metric_idx').on(t.securityId, t.metricName, t.retrievedAt),
    statusIdx: index('market_observations_status_idx').on(t.status, t.retrievedAt),
  })
);

/** LLM-extracted PDF facts remain quarantined until the owner reviews them. */
export const financialDocumentDrafts = pgTable('financial_document_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  candidateId: uuid('candidate_id').references(() => discoveryCandidates.id, { onDelete: 'cascade' }).notNull(),
  fileName: text('file_name').notNull(),
  pdfBase64: text('pdf_base64').notNull(),
  sha256: text('sha256').notNull(),
  extractionJson: jsonb('extraction_json').notNull(),
  analysisJson: jsonb('analysis_json').notNull(),
  status: text('status').notNull().default('awaiting_review'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
}, (t) => ({ ownerCandidateIdx: index('financial_document_owner_candidate_idx').on(t.ownerId, t.candidateId, t.createdAt) }));

/** Versioned owner customization layered beneath immutable agent safety rules. */
export const agentConfigurations = pgTable(
  'agent_configurations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    agentKind: text('agent_kind').notNull(),
    versionNumber: integer('version_number').notNull(),
    name: text('name').notNull(),
    scope: text('scope').notNull(),
    promptAddendum: text('prompt_addendum').notNull().default(''),
    enabledTools: jsonb('enabled_tools').$type<string[]>().notNull(),
    active: boolean('active').notNull().default(true),
    runtimePolicy: jsonb('runtime_policy').$type<import('@portfolio-intelligence/agentic-contract').RuntimePolicy>(),
    rolloutState: text('rollout_state').notNull().default('production'),
    evaluation: jsonb('evaluation'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    ownerKindVersionIdx: uniqueIndex('agent_configs_owner_kind_version_idx')
      .on(t.ownerId, t.agentKind, t.versionNumber),
    activeIdx: index('agent_configs_owner_kind_active_idx').on(t.ownerId, t.agentKind, t.active),
  })
);

/** One provider-grounded opportunity-discovery job over a confirmed thesis. */
export const externalDiscoveryRuns = pgTable(
  'external_discovery_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    thesisVersionId: uuid('thesis_version_id').references(() => thesisVersions.id).notNull(),
    externalDiscoveryId: text('external_discovery_id').notNull().unique(),
    status: text('status').notNull().default('queued'),
    provider: text('provider').notNull(),
    requestJson: jsonb('request_json').notNull(),
    resultJson: jsonb('result_json'),
    errorMessage: text('error_message'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({ ownerStatusIdx: index('discovery_runs_owner_status_idx').on(t.ownerId, t.status, t.requestedAt) })
);

/** Shortlisted security awaiting an explicit human decision before analysis. */
export const discoveryCandidates = pgTable(
  'discovery_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    runId: uuid('run_id').references(() => externalDiscoveryRuns.id, { onDelete: 'cascade' }).notNull(),
    portfolioId: uuid('portfolio_id').references(() => portfolios.id, { onDelete: 'cascade' }).notNull(),
    securityId: uuid('security_id').references(() => securities.id, { onDelete: 'set null' }),
    ticker: text('ticker').notNull(),
    exchange: text('exchange').notNull(),
    companyName: text('company_name').notNull(),
    currency: text('currency').notNull(),
    country: text('country'),
    sector: text('sector'),
    industry: text('industry'),
    classificationSource: text('classification_source').notNull().default('unclassified'),
    discoveryJson: jsonb('discovery_json').notNull(),
    decision: text('decision').notNull().default('pending'),
    rationale: text('decision_rationale'),
    decisionJournal: jsonb('decision_journal'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    workflowStatus: text('workflow_status').notNull().default('awaiting_review'),
    externalMarketBriefId: text('external_market_brief_id'),
    marketBriefStatus: text('market_brief_status').notNull().default('not_started'),
    marketBriefRequestJson: jsonb('market_brief_request_json'),
    marketBriefJson: jsonb('market_brief_json'),
    marketBriefErrorMessage: text('market_brief_error_message'),
    externalAnalysisRunId: text('external_analysis_run_id'),
    analysisErrorMessage: text('analysis_error_message'),
    analysisId: uuid('analysis_id').references(() => aiAnalyses.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    runSecurityIdx: uniqueIndex('discovery_candidates_run_security_idx')
      .on(t.runId, t.portfolioId, t.exchange, t.ticker),
    ownerWorkflowIdx: index('discovery_candidates_owner_workflow_idx').on(t.ownerId, t.workflowStatus, t.createdAt),
  })
);

/** Deterministic standalone metrics calculated from a candidate's price series. */
export const securityRiskSnapshots = pgTable(
  'security_risk_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    candidateId: uuid('candidate_id').references(() => discoveryCandidates.id, { onDelete: 'cascade' }).notNull(),
    securityId: uuid('security_id').references(() => securities.id, { onDelete: 'cascade' }).notNull(),
    metricsJson: jsonb('metrics_json').notNull(),
    provider: text('provider').notNull(),
    dataAsOf: timestamp('data_as_of', { withTimezone: true }).notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ candidateTimeIdx: index('security_risk_candidate_time_idx').on(t.candidateId, t.computedAt) })
);

/** Human-confirmed assumptions and deterministic valuation output. */
export const valuationScenarios = pgTable(
  'valuation_scenarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    candidateId: uuid('candidate_id').references(() => discoveryCandidates.id, { onDelete: 'cascade' }).notNull(),
    analysisId: uuid('analysis_id').references(() => aiAnalyses.id, { onDelete: 'set null' }),
    method: text('method').notNull(),
    status: text('status').notNull(),
    assumptionsJson: jsonb('assumptions_json').notNull(),
    resultJson: jsonb('result_json').notNull(),
    sourceReferences: jsonb('source_references').$type<string[]>().notNull(),
    approvedBy: text('approved_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ candidateCreatedIdx: index('valuation_candidate_created_idx').on(t.candidateId, t.createdAt) })
);

/** Human-in-the-loop decisions over AI-generated candidate analyses. */
export const candidateDecisions = pgTable(
  'candidate_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    analysisId: uuid('analysis_id').references(() => aiAnalyses.id, { onDelete: 'cascade' }).notNull(),
    decision: text('decision').notNull(), // accepted | rejected | watchlist | reanalysis_requested
    rationale: text('rationale'),
    decidedBy: text('decided_by').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb('metadata'),
  },
  (t) => ({ analysisDecisionIdx: index('candidate_decisions_analysis_idx').on(t.analysisId, t.decidedAt) })
);

/** Write-audit record for thesis mutations. */
export const thesisMutationAudit = pgTable(
  'thesis_mutation_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    thesisVersionId: uuid('thesis_version_id').references(() => thesisVersions.id, { onDelete: 'cascade' }).notNull(),
    action: text('action').notNull(),
    actor: text('actor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb('metadata'),
  },
  (t) => ({ thesisAuditIdx: index('thesis_mutation_audit_thesis_idx').on(t.thesisVersionId, t.createdAt) })
);

/** Pending model extraction. It becomes canonical only after explicit human confirmation. */
export const externalThesisExtractions = pgTable(
  'external_thesis_extractions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    externalExtractionId: text('external_extraction_id').notNull().unique(),
    status: text('status').notNull().default('queued'),
    requestedVersion: integer('requested_version').notNull(),
    sourceFileName: text('source_file_name').notNull(),
    sourceMimeType: text('source_mime_type').notNull(),
    resultJson: jsonb('result_json'),
    errorMessage: text('error_message'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedThesisVersionId: uuid('confirmed_thesis_version_id')
      .references(() => thesisVersions.id, { onDelete: 'set null' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedBy: text('dismissed_by'),
  },
  (t) => ({
    ownerStatusIdx: index('external_thesis_extractions_owner_status_idx').on(t.ownerId, t.status, t.requestedAt),
  })
);

/** Dashboard record of a run owned by the external agentic system. */
export const externalAgenticRuns = pgTable(
  'external_agentic_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    /** Immutable account binding for authenticated agentic callbacks. */
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
    externalRunId: text('external_run_id').notNull().unique(),
    status: text('status').notNull().default('queued'),
    thesisVersion: text('thesis_version'),
    manifestSchemaVersion: text('manifest_schema_version'),
    manifestHash: text('manifest_hash'),
    requestJson: jsonb('request_json'),
    manifestJson: jsonb('manifest_json'),
    reportPdfUrl: text('report_pdf_url'),
    requestedAt: timestamp('requested_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
    importedAt: timestamp('imported_at'),
    errorMessage: text('error_message'),
  },
  (t) => ({
    statusIdx: index('external_agentic_runs_status_idx').on(t.status, t.requestedAt),
    accountStatusIdx: index('external_agentic_runs_account_status_idx').on(t.accountId, t.status, t.requestedAt),
    hashIdx: index('external_agentic_runs_manifest_hash_idx').on(t.manifestHash),
  })
);

/** Portfolio-level synthesis imported from the external manifest. */
export const portfolioAnalysisSyntheses = pgTable(
  'portfolio_analysis_syntheses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').references(() => externalAgenticRuns.id, { onDelete: 'cascade' }).notNull(),
    portfolioId: uuid('portfolio_id').references(() => portfolios.id, { onDelete: 'cascade' }).notNull(),
    thesisVersion: text('thesis_version').notNull(),
    synthesisJson: jsonb('synthesis_json').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    runPortfolioIdx: uniqueIndex('portfolio_synthesis_run_portfolio_idx').on(t.runId, t.portfolioId),
  })
);

/** Complete external output retained for audit and fields not projected into ai_analyses. */
export const externalAgenticAnalyses = pgTable(
  'external_agentic_analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').references(() => externalAgenticRuns.id, { onDelete: 'cascade' }).notNull(),
    portfolioId: uuid('portfolio_id').references(() => portfolios.id, { onDelete: 'cascade' }).notNull(),
    securityId: uuid('security_id').references(() => securities.id, { onDelete: 'cascade' }).notNull(),
    analysisId: uuid('analysis_id').references(() => aiAnalyses.id, { onDelete: 'cascade' }).notNull(),
    outputJson: jsonb('output_json').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    runSecurityIdx: uniqueIndex('external_analysis_run_portfolio_security_idx').on(t.runId, t.portfolioId, t.securityId),
  })
);

/**
 * Every attempted external market-data call, win or lose. This is the record
 * that answers "why is my universe unranked" or "how much of today's budget
 * is spent" without guessing — and it backs the gateway's own decisions: the
 * daily call budget counts rows here, and a recent plan_limit row is what
 * lets a later call skip a network round trip already known to fail.
 */
export const providerCalls = pgTable(
  'provider_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    // A stable route template, never the full URL: no API key, no per-symbol
    // segment. See endpointTemplate() in src/lib/connectors/gateway.ts.
    endpoint: text('endpoint').notNull(),
    calledAt: timestamp('called_at', { withTimezone: true }).defaultNow().notNull(),
    outcome: text('outcome').notNull(), // ok | plan_limit | rate_limited | error
    httpStatus: integer('http_status'),
    durationMs: integer('duration_ms').notNull(),
  },
  (t) => ({
    providerCalledIdx: index('provider_calls_provider_called_idx').on(t.provider, t.calledAt),
    endpointOutcomeIdx: index('provider_calls_endpoint_outcome_idx').on(t.provider, t.endpoint, t.outcome, t.calledAt),
  })
);

/** Immutable price/config/result snapshot; final audit can be written only once by a human. */
export const portfolioWeightRuns = pgTable('portfolio_weight_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  portfolioId: uuid('portfolio_id').references(() => portfolios.id, { onDelete: 'cascade' }).notNull(),
  actorId: uuid('actor_id').references(() => users.id).notNull(),
  pricesCsv: text('prices_csv').notNull(),
  priceHash: text('price_hash').notNull(),
  source: text('source').notNull(),
  currency: text('currency').notNull(),
  holdingsHash: text('holdings_hash').notNull(),
  baseDecisionId: uuid('base_decision_id'),
  configJson: jsonb('config_json').$type<import('../portfolio-weights').WeightConfig>().notNull(),
  resultJson: jsonb('result_json').$type<import('../portfolio-weights').WeightResult>().notNull(),
  finalJson: jsonb('final_json').$type<import('../portfolio-weights').FinalWeights>(),
  confirmedBy: uuid('confirmed_by').references(() => users.id),
  acknowledgedWarnings: jsonb('acknowledged_warnings').$type<string[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
}, t => ({ portfolioCreatedIdx: index('weight_runs_portfolio_created_idx').on(t.portfolioId, t.createdAt) }));

/** Immutable, read-only snapshot retrieved from a connected broker session. */
export const brokerAccountSnapshots = pgTable('broker_account_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  provider: text('provider').notNull(),
  accountMasked: text('account_masked').notNull(),
  baseCurrency: text('base_currency').notNull(),
  cash: numeric('cash', { precision: 24, scale: 8 }).notNull(),
  netLiquidation: numeric('net_liquidation', { precision: 24, scale: 8 }).notNull(),
  availableFunds: numeric('available_funds', { precision: 24, scale: 8 }).notNull(),
  buyingPower: numeric('buying_power', { precision: 24, scale: 8 }).notNull(),
  informationGaps: jsonb('information_gaps').$type<string[]>().notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({ ownerCapturedIdx: index('broker_snapshot_owner_captured_idx').on(t.ownerId, t.capturedAt) }));

export const brokerPositionSnapshots = pgTable('broker_position_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  snapshotId: uuid('snapshot_id').references(() => brokerAccountSnapshots.id, { onDelete: 'cascade' }).notNull(),
  conId: text('con_id').notNull(),
  symbol: text('symbol').notNull(),
  exchange: text('exchange').notNull(),
  currency: text('currency').notNull(),
  quantity: numeric('quantity', { precision: 24, scale: 8 }).notNull(),
  avgCost: numeric('avg_cost', { precision: 24, scale: 8 }).notNull(),
  lastPrice: numeric('last_price', { precision: 24, scale: 8 }).notNull(),
  costBasis: numeric('cost_basis', { precision: 24, scale: 8 }).notNull(),
  marketValue: numeric('market_value', { precision: 24, scale: 8 }).notNull(),
  unrealizedPnl: numeric('unrealized_pnl', { precision: 24, scale: 8 }).notNull(),
  returnPct: real('return_pct'),
  firstDetectedFill: text('first_detected_fill'),
  daysSinceDetectedFill: integer('days_since_detected_fill'),
  annualizedReturnPct: real('annualized_return_pct'),
}, t => ({ snapshotValueIdx: index('broker_position_snapshot_value_idx').on(t.snapshotId, t.marketValue) }));

/** Preview audit. Results can never represent submitted or filled orders. */
export const brokerOrderPreviews = pgTable('broker_order_previews', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  snapshotId: uuid('snapshot_id').references(() => brokerAccountSnapshots.id, { onDelete: 'set null' }),
  provider: text('provider').notNull(),
  requestJson: jsonb('request_json').notNull(),
  resultJson: jsonb('result_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({ ownerCreatedIdx: index('broker_preview_owner_created_idx').on(t.ownerId, t.createdAt) }));

/** One logical, tenant-isolated document repository for a held security. */
export const companyWorkspaces = pgTable('company_workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  securityId: uuid('security_id').references(() => securities.id, { onDelete: 'cascade' }).notNull(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  ticker: text('ticker').notNull(),
  exchange: text('exchange').notNull(),
  country: text('country'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastIngestedAt: timestamp('last_ingested_at', { withTimezone: true }),
  documentCount: integer('document_count').notNull().default(0),
  chunkCount: integer('chunk_count').notNull().default(0),
  ragEnabled: boolean('rag_enabled').notNull().default(false),
}, t => ({
  securityOwnerIdx: uniqueIndex('cw_security_owner_idx').on(t.securityId, t.ownerId),
  ownerIdx: index('cw_owner_idx').on(t.ownerId),
}));

export const intelligenceDocuments = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => companyWorkspaces.id, { onDelete: 'cascade' }).notNull(),
  securityId: uuid('security_id').references(() => securities.id, { onDelete: 'cascade' }).notNull(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  folderType: text('folder_type').notNull(),
  documentType: text('document_type').notNull(),
  source: text('source').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  url: text('url'),
  localPath: text('local_path'),
  contentHash: text('content_hash'),
  externalId: text('external_id'),
  publishedDate: timestamp('published_date', { withTimezone: true }),
  fiscalYearEnd: date('fiscal_year_end'),
  fiscalPeriod: text('fiscal_period'),
  retrievedAt: timestamp('retrieved_at', { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  contentText: text('content_text'),
  contentLength: integer('content_length'),
  processingStatus: text('processing_status').notNull().default('pending'),
  processingError: text('processing_error'),
  retryCount: integer('retry_count').notNull().default(0),
  language: text('language').default('en'),
  pageCount: integer('page_count'),
  fileFormat: text('file_format'),
  isPrimarySource: boolean('is_primary_source').notNull().default(true),
  isAmendment: boolean('is_amendment').default(false),
  amendedDocumentId: uuid('amended_document_id').references((): AnyPgColumn => intelligenceDocuments.id),
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
  metadataJson: jsonb('metadata_json'),
}, t => ({
  workspaceIdx: index('documents_workspace_idx').on(t.workspaceId),
  securityIdx: index('documents_security_idx').on(t.securityId),
  ownerIdx: index('documents_owner_idx').on(t.ownerId),
  typeIdx: index('documents_type_idx').on(t.folderType, t.documentType),
  statusIdx: index('documents_status_idx').on(t.processingStatus),
  externalIdIdx: index('documents_external_id_idx').on(t.externalId),
  contentHashIdx: index('documents_content_hash_idx').on(t.contentHash),
  publishedDateIdx: index('documents_published_date_idx').on(t.publishedDate),
}));

export const documentChunks = pgTable('document_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').references(() => intelligenceDocuments.id, { onDelete: 'cascade' }).notNull(),
  workspaceId: uuid('workspace_id').references(() => companyWorkspaces.id, { onDelete: 'cascade' }).notNull(),
  securityId: uuid('security_id').references(() => securities.id, { onDelete: 'cascade' }).notNull(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  chunkText: text('chunk_text').notNull(),
  chunkLength: integer('chunk_length').notNull(),
  contextBefore: text('context_before'),
  contextAfter: text('context_after'),
  sectionTitle: text('section_title'),
  sectionType: text('section_type'),
  chunkHash: text('chunk_hash').notNull(),
  embeddingStatus: text('embedding_status').notNull().default('pending'),
  embeddedAt: timestamp('embedded_at', { withTimezone: true }),
}, t => ({
  documentIdx: index('chunks_document_idx').on(t.documentId),
  workspaceIdx: index('chunks_workspace_idx').on(t.workspaceId),
  securityIdx: index('chunks_security_idx').on(t.securityId),
  ownerIdx: index('chunks_owner_idx').on(t.ownerId),
  statusIdx: index('chunks_embedding_status_idx').on(t.embeddingStatus),
}));

export const documentEmbeddings = pgTable('document_embeddings', {
  id: uuid('id').primaryKey().defaultRandom(),
  chunkId: uuid('chunk_id').references(() => documentChunks.id, { onDelete: 'cascade' }).notNull(),
  documentId: uuid('document_id').references(() => intelligenceDocuments.id, { onDelete: 'cascade' }).notNull(),
  workspaceId: uuid('workspace_id').references(() => companyWorkspaces.id, { onDelete: 'cascade' }).notNull(),
  securityId: uuid('security_id').references(() => securities.id, { onDelete: 'cascade' }).notNull(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  embedding: vector('embedding', { dimensions: 768 }).notNull(),
  embeddingModel: text('embedding_model').notNull().default('text-embedding-004'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  documentIdx: index('emb_document_idx').on(t.documentId),
  workspaceIdx: index('emb_workspace_idx').on(t.workspaceId),
  securityIdx: index('emb_security_idx').on(t.securityId),
  ownerIdx: index('emb_owner_idx').on(t.ownerId),
  vectorIdx: index('document_embeddings_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')).with({ m: 16, ef_construction: 64 }),
}));

export const ingestionJobs = pgTable('ingestion_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => companyWorkspaces.id, { onDelete: 'cascade' }).notNull(),
  securityId: uuid('security_id').references(() => securities.id, { onDelete: 'cascade' }).notNull(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  jobType: text('job_type').notNull(),
  status: text('status').notNull().default('queued'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  documentsDiscovered: integer('documents_discovered').default(0),
  documentsIngested: integer('documents_ingested').default(0),
  chunksCreated: integer('chunks_created').default(0),
  chunksEmbedded: integer('chunks_embedded').default(0),
  errorMessage: text('error_message'),
  logJson: jsonb('log_json').$type<string[]>(),
  triggeredBy: text('triggered_by').default('schedule'),
}, t => ({
  workspaceIdx: index('ij_workspace_idx').on(t.workspaceId),
  statusIdx: index('ij_status_idx').on(t.status),
  typeIdx: index('ij_type_idx').on(t.jobType, t.status),
}));

export const ragConversations = pgTable('rag_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => companyWorkspaces.id, { onDelete: 'cascade' }).notNull(),
  securityId: uuid('security_id').references(() => securities.id, { onDelete: 'cascade' }).notNull(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').default('New Conversation'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  workspaceIdx: index('rag_conv_workspace_idx').on(t.workspaceId),
  userIdx: index('rag_conv_user_idx').on(t.userId),
}));

export type RagCitation = { chunkId: string; documentId: string; documentTitle: string; source: string; publishedDate: string; excerpt: string; relevanceScore: number; isPrimarySource: boolean };
export const ragMessages = pgTable('rag_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').references(() => ragConversations.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  citationsJson: jsonb('citations_json').$type<RagCitation[]>(),
  retrievedChunksJson: jsonb('retrieved_chunks_json'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  model: text('model').default('gemini-1.5-flash'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({ conversationIdx: index('rag_msg_conversation_idx').on(t.conversationId) }));
