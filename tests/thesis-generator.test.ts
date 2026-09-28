import { describe, expect, it } from 'vitest';
import { toAgenticThesisDocument, validateThesisDocument } from '../src/lib/document-security';
import { generatedThesisFileName, renderGeneratedThesisPdf } from '../src/lib/thesis-generator';
import { ThesisExtractionRequest } from '@portfolio-intelligence/agentic-contract';

describe('thesis generator', () => {
  it('creates a substantive static PDF accepted by the thesis upload validator', async () => {
    const pdf = await renderGeneratedThesisPdf({
      title: 'Long-term mandate', investorName: 'Investor', purpose: 'Compound capital responsibly', timeHorizon: 'Ten years', riskTolerance: 'Moderate',
      markets: ['Switzerland'], globalConstraints: ['Avoid excessive leverage'], reviewCadence: 'Quarterly',
      mandates: [{ role: 'swiss_quality', label: 'Swiss quality', currency: 'CHF', objective: 'Durable compounding', inclusionCriteria: ['Strong balance sheet'], exclusionCriteria: ['Weak governance'] }],
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1_000);
    const validated = validateThesisDocument({ fileName: generatedThesisFileName('Long-term mandate'), mimeType: 'application/pdf', contentBase64: pdf.toString('base64') });
    expect(validated.byteLength).toBe(pdf.length);
    const extractionDocument = toAgenticThesisDocument(validated, 1);
    expect(ThesisExtractionRequest.safeParse({ document: extractionDocument }).success).toBe(true);
    expect(extractionDocument).not.toHaveProperty('byteLength');
  });
});
