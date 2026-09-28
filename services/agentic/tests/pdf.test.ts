import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { renderReportPdf } from '../src/pdf.js';
import { executeMarketAnalysis } from '../src/market-orchestrator.js';
import { manifest } from './fixtures.js';

describe('human-facing PDF report', () => {
  it('renders genuine, non-trivial PDF bytes from the validated manifest', async () => {
    const reviewed = structuredClone(manifest);
    reviewed.portfolios[0].analyses[0].marketAnalysis = await executeMarketAnalysis({ ticker: 'TEST', companyName: 'Test', exchange: 'XSWX', currency: 'CHF', country: null, sector: null, fundamentals: {}, computedMetrics: {}, dataAsOf: reviewed.generatedAt }, async () => ({ status: 'insufficient_data', claims: [], risks: [], missingInputs: ['Verified market context'] }));
    const pdf = await renderReportPdf(reviewed, 'agent-run-pdf-test');
    if (process.env.PDF_TEST_OUTPUT) {
      await mkdir(dirname(process.env.PDF_TEST_OUTPUT), { recursive: true });
      await writeFile(process.env.PDF_TEST_OUTPUT, pdf);
    }
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5_000);
    expect(pdf.subarray(-20).toString('latin1')).toContain('%%EOF');
  });
});
