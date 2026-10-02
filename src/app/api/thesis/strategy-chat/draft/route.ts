import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { ThesisCriteria, ThesisExtractionResult } from '@portfolio-intelligence/agentic-contract';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { thesisVersions } from '@/lib/db/schema';
import { externalThesisExtractions } from '@/lib/db/workflow-schema';
import { readBoundedJson } from '@/lib/request-body';
import { assessThesisReview } from '@/lib/thesis-review';
import { criteriaFromPortfolioStrategy, PortfolioStrategyDraft } from '@/lib/portfolio-strategy-chat';
import { generatedThesisFileName, renderGeneratedThesisPdf } from '@/lib/thesis-generator';
import { DocumentValidationError, validateThesisDocument } from '@/lib/document-security';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  const body = await readBoundedJson(req, 64 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = PortfolioStrategyDraft.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const [latest] = await db.select({ versionNumber: thesisVersions.versionNumber })
      .from(thesisVersions).where(eq(thesisVersions.ownerId, session.auth.userId))
      .orderBy(desc(thesisVersions.versionNumber)).limit(1);
    const requestedVersion = (latest?.versionNumber ?? 0) + 1;
    const criteria = ThesisCriteria.parse(criteriaFromPortfolioStrategy(parsed.data, requestedVersion));
    const review = assessThesisReview(criteria);
    if (review.errors.length) return NextResponse.json({ error: 'Correct the strategy before creating its PDF.', review }, { status: 422 });

    const pdf = await renderGeneratedThesisPdf({ ...parsed.data, mandates: parsed.data.mandates });
    const fileName = generatedThesisFileName(parsed.data.title);
    const document = validateThesisDocument({ fileName, mimeType: 'application/pdf', contentBase64: pdf.toString('base64') });
    const resultJson = ThesisExtractionResult.parse({
      criteria,
      // This field is required by the shared extraction contract. Chat-created
      // drafts are identified as such in the UI and are not presented with an
      // extraction-confidence percentage.
      extractionConfidence: 1,
      ambiguousPoints: [],
      unmappedContent: [],
    });
    const [extraction] = await db.insert(externalThesisExtractions).values({
      ownerId: session.auth.userId,
      externalExtractionId: `strategy-chat:${randomUUID()}`,
      status: 'completed',
      requestedVersion,
      sourceFileName: document.fileName,
      sourceMimeType: document.mimeType,
      resultJson,
      completedAt: new Date(),
    }).returning();
    return NextResponse.json({ extraction, generatedDocument: { fileName, contentBase64: document.contentBase64 } }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof DocumentValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Unable to create the strategy PDF. Your draft is still available; try again.' }, { status: 500 });
  }
}
