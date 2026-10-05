import {
  DiscoveryRunRequest,
  MarketBriefRequest,
  ThesisExtractionRequest,
} from '@portfolio-intelligence/agentic-contract';
import { AgenticPipelineError, OpenAIAgenticPipeline } from './openai-pipeline.js';
import type { AgenticJob, JobRepository } from './types.js';

export interface ProcessingDependencies {
  repository: JobRepository;
  /**
   * The generic service is intentionally restricted to preparatory research.
   * Security analysis, valuation, debate and synthesis belong exclusively to
   * the canonical Research Director finance runtime.
   */
  pipeline: Pick<OpenAIAgenticPipeline, 'extractThesis' | 'discoverSecurities' | 'researchMarket'>;
}

export async function processJob(job: AgenticJob, deps: ProcessingDependencies): Promise<void> {
  try {
    if (job.kind === 'thesis_extraction') {
      const request = ThesisExtractionRequest.safeParse(job.payload);
      if (!request.success) throw new AgenticPipelineError('extraction', 'Stored thesis payload failed contract validation');
      await deps.repository.updateProgress(job.id, 0, 1, 'thesis_extraction', job.attemptCount);
      const result = await deps.pipeline.extractThesis(request.data.document, request.data.agentConfig);
      await deps.repository.completeExtraction(job.id, result, job.attemptCount);
      return;
    }

    if (job.kind === 'market_discovery') {
      const request = DiscoveryRunRequest.safeParse(job.payload);
      if (!request.success) throw new AgenticPipelineError('analysis', 'Stored discovery payload failed contract validation');
      await deps.repository.updateProgress(job.id, 0, 1, 'market_discovery', job.attemptCount);
      const result = await deps.pipeline.discoverSecurities(
        request.data,
        (completed, total, stage) => deps.repository.updateProgress(job.id, completed, total, stage, job.attemptCount)
      );
      await deps.repository.completeDiscovery(job.id, result, job.attemptCount);
      return;
    }

    if (job.kind === 'market_brief') {
      const request = MarketBriefRequest.safeParse(job.payload);
      if (!request.success) throw new AgenticPipelineError('market_brief', 'Stored market brief payload failed contract validation');
      await deps.repository.updateProgress(job.id, 0, 5, 'market_brief_sources', job.attemptCount);
      const result = await deps.pipeline.researchMarket(request.data, async (stage) => {
        const completed = stage === 'market_brief_synthesis'
          ? 4
          : Math.max(0, ['maritaca_data_ocean', 'brapi_financial_indicators', 'sec_edgar_filings', 'independent_web_research'].indexOf(stage));
        await deps.repository.updateProgress(job.id, completed, 5, stage, job.attemptCount);
      });
      await deps.repository.completeMarketBrief(job.id, result, job.attemptCount);
      return;
    }

    // Historical analysis_run rows remain readable, but can never execute again.
    // This is a fail-closed invariant: only agent_analysis_sessions may initiate
    // security research, valuation, bull/bear debate and final synthesis.
    await deps.repository.fail(
      job.id,
      'analysis',
      'Legacy security-analysis orchestration is retired. Start a canonical Research Director session instead.',
      job.attemptCount
    );
  } catch (error) {
    const stage = error instanceof AgenticPipelineError
      ? error.stage
      : job.kind === 'thesis_extraction' ? 'extraction' : job.kind === 'market_brief' ? 'market_brief' : 'analysis';
    const safeMessage = error instanceof AgenticPipelineError
      ? error.message
      : 'Agentic preparatory job failed unexpectedly; no research output was silently accepted';
    await deps.repository.fail(job.id, stage, safeMessage, job.attemptCount);
  }
}
