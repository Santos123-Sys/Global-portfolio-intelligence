import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const genericProcessor = readFileSync('services/agentic/src/process-job.ts', 'utf8');
const genericHttp = readFileSync('services/agentic/src/http-server.ts', 'utf8');
const legacyDashboardRoute = readFileSync('src/app/api/integrations/agentic/runs/route.ts', 'utf8');
const candidateHandoff = readFileSync('src/app/api/discovery/market-brief/route.ts', 'utf8');
const candidateQueue = readFileSync('src/lib/canonical-candidate-analysis.ts', 'utf8');
const canonicalQueue = readFileSync('src/lib/agent-finance/queue-session.ts', 'utf8');
const schema = readFileSync('src/lib/db/workflow-schema.ts', 'utf8');
const migration = readFileSync('drizzle/0026_canonical_research_orchestrator.sql', 'utf8');

describe('canonical Research Director orchestration authority', () => {
  it('prevents the generic worker from orchestrating security analysis or portfolio synthesis', () => {
    expect(genericProcessor).not.toContain('analyzeSecurity(');
    expect(genericProcessor).not.toContain('synthesizePortfolio(');
    expect(genericProcessor).not.toContain('buildManifest(');
    expect(genericProcessor).toContain('Legacy security-analysis orchestration is retired');
  });

  it('fails closed at both legacy analysis write APIs while retaining compatibility reads', () => {
    expect(genericHttp).toContain("url.pathname === '/v1/analysis-runs' && request.method === 'POST'");
    expect(genericHttp).toContain("legacy_analysis_orchestration_retired");
    expect(genericHttp).toContain("runMatch && request.method === 'GET'");
    expect(legacyDashboardRoute).toContain('legacyAnalysisWritesEnabled: false');
    expect(legacyDashboardRoute).toContain("canonicalPath: '/api/agents/analyze'");
  });

  it('routes approved Discovery research into the same canonical session queue as direct analysis', () => {
    expect(candidateHandoff).toContain('queueApprovedCandidateResearch');
    expect(candidateHandoff).not.toContain('startApprovedCandidateAnalysis');
    expect(candidateQueue).toContain("analysisType: 'fundamental'");
    expect(candidateQueue).toContain('queueAnalysisSession({');
    expect(candidateQueue).not.toContain('startExternalAgenticRun');
    expect(canonicalQueue).toContain('agentAnalysisSessions');
    expect(canonicalQueue).toContain("origin?: 'direct' | 'discovery_candidate'");
  });

  it('persists an additive canonical-session link without deleting historical run identity', () => {
    expect(schema).toContain("externalAnalysisRunId: text('external_analysis_run_id')");
    expect(schema).toContain("analysisSessionId: uuid('analysis_session_id')");
    expect(migration).toContain('ADD COLUMN "analysis_session_id" uuid');
    expect(migration).not.toMatch(/DROP\s+(?:COLUMN|TABLE)/i);
  });
});
