import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgenticHttpServer } from '../src/http-server.js';
import { hashManifest } from '../src/manifest.js';
import { MemoryRepository } from './memory-repository.js';
import { manifest, runRequest, portfolioId, thesisVersionId, thesis } from './fixtures.js';

const apiKey = 'agentic-test-key-12345678901234567890';

describe('agentic HTTP API', () => {
  const repository = new MemoryRepository();
  const storage = { get: async () => Buffer.from('%PDF-1.4\n%%EOF\n') };
  const server = createAgenticHttpServer({ repository, storage, apiKey });
  let baseUrl = '';

  beforeEach(async () => {
    repository.jobs.clear();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const authenticated = (init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', ...init.headers },
  });

  it('exposes a database-backed health check without exposing v1 endpoints', async () => {
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/v1/analysis-runs`)).status).toBe(401);
  });

  it('rejects creation of legacy analysis runs without persisting a job', async () => {
    const response = await fetch(`${baseUrl}/v1/analysis-runs`, authenticated({
      method: 'POST',
      body: JSON.stringify(runRequest),
    }));
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      error: 'legacy_analysis_orchestration_retired',
      canonicalPath: '/api/agents/analyze',
    });
    expect(repository.jobs.size).toBe(0);
  });

  it('atomically reuses Discovery dispatch IDs and rejects changed payloads', async () => {
    const input = { dispatchId: '11111111-1111-4111-8111-111111111111', thesis: { versionId: thesisVersionId, criteria: thesis },
      portfolios: [{ id: portfolioId, name: 'Swiss', role: 'swiss_quality', baseCurrency: 'CHF', investmentObjective: 'Quality' }],
      universe: [{ ticker: 'AAA', exchange: 'XSWX', companyName: 'Example', currency: 'CHF', country: null, sector: null, industry: null, assetType: 'Common Stock', observedAt: '2026-09-27T00:00:00Z', provider: 'test', sourceUrl: 'https://example.test', attributes: {} }], maxCandidatesPerPortfolio: 6 };
    const send = (value: unknown) => fetch(`${baseUrl}/v1/discovery-runs`, authenticated({ method: 'POST', body: JSON.stringify(value) }));
    const responses = await Promise.all([send(input), send(input)]);
    expect(responses.map(r => r.status)).toEqual([202, 202]);
    const bodies = await Promise.all(responses.map(r => r.json())) as Array<{externalDiscoveryId: string}>;
    expect(bodies[0].externalDiscoveryId).toBe(`discovery_${input.dispatchId}`);
    expect(bodies[1].externalDiscoveryId).toBe(bodies[0].externalDiscoveryId);
    expect(repository.jobs.size).toBe(1);
    expect((await send({ ...input, maxCandidatesPerPortfolio: 3 })).status).toBe(409);
    expect(repository.jobs.size).toBe(1);
  });

  it('requires JSON for active preparatory endpoints, permits passive initial PDF views, and rejects active PDF content', async () => {
    const wrongType = await fetch(`${baseUrl}/v1/thesis-extractions`, authenticated({
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({}),
    }));
    expect(wrongType.status).toBe(415);

    const passivePdf = Buffer.from('%PDF-1.4\n/OpenAction [1 0 R /XYZ null null 0]\n%%EOF').toString('base64');
    const passiveResponse = await fetch(`${baseUrl}/v1/thesis-extractions`, authenticated({
      method: 'POST',
      body: JSON.stringify({ document: { version: 1, fileName: 'office-export.pdf', mimeType: 'application/pdf', contentBase64: passivePdf } }),
    }));
    expect(passiveResponse.status).toBe(202);

    const activePdf = Buffer.from('%PDF-1.4\n/OpenAction << /S /JavaScript /JS (alert(1)) >>\n%%EOF').toString('base64');
    const activeResponse = await fetch(`${baseUrl}/v1/thesis-extractions`, authenticated({
      method: 'POST',
      body: JSON.stringify({ document: { version: 1, fileName: 'active.pdf', mimeType: 'application/pdf', contentBase64: activePdf } }),
    }));
    expect(activeResponse.status).toBe(400);
    expect(repository.jobs.size).toBe(1);
  });

  it('keeps historical failed analysis state readable but refuses legacy retry', async () => {
    const created = await repository.create('analysis_run', 'agent-run-fixed', runRequest, 4);
    await repository.fail(created.id, 'analysis', 'Security analysis failed safely');
    const failed = await fetch(`${baseUrl}/v1/analysis-runs/agent-run-fixed`, authenticated());
    expect(await failed.json()).toMatchObject({
      externalRunId: 'agent-run-fixed',
      status: 'failed',
      errorMessage: 'Security analysis failed safely',
    });
    const retried = await fetch(`${baseUrl}/v1/analysis-runs/agent-run-fixed/retry`, authenticated({ method: 'POST' }));
    expect(retried.status).toBe(410);
    expect(await retried.json()).toMatchObject({ error: 'legacy_analysis_orchestration_retired' });
    expect((await repository.findByExternalId('agent-run-fixed'))?.status).toBe('failed');
  });

  it('keeps completed historical manifests and reports readable', async () => {
    const created = await repository.create('analysis_run', 'agent-run-complete', runRequest, 4);
    await repository.completeAnalysis(created.id, manifest, hashManifest(manifest), {
      objectKey: 'reports/agent-run-complete.pdf',
      bytes: null,
    });
    const status = await fetch(`${baseUrl}/v1/analysis-runs/agent-run-complete`, authenticated());
    expect(await status.json()).toMatchObject({ status: 'completed', manifest });
    const report = await fetch(`${baseUrl}/v1/analysis-runs/agent-run-complete/report`, authenticated());
    expect(report.status).toBe(200);
    expect(report.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await report.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('queues thesis extraction without logging or returning raw document content', async () => {
    const source = 'Swiss quality companies only.';
    const response = await fetch(`${baseUrl}/v1/thesis-extractions`, authenticated({
      method: 'POST',
      body: JSON.stringify({ document: { version: 2, fileName: 'thesis.txt', mimeType: 'text/plain', contentBase64: Buffer.from(source).toString('base64') } }),
    }));
    expect(response.status).toBe(202);
    expect(JSON.stringify(await response.json())).not.toContain(source);
  });
});
