import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { ThesisCriteria, ThesisExtractionResult } from '@portfolio-intelligence/agentic-contract';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { thesisVersions } from '@/lib/db/schema';
import { externalThesisExtractions, portfolioCreatorSessions } from '@/lib/db/workflow-schema';
import { readBoundedJson } from '@/lib/request-body';
import { assessThesisReview } from '@/lib/thesis-review';
import { criteriaFromPortfolioStrategy } from '@/lib/portfolio-strategy-chat';
import { attachProfileToDraft, requiredCreatorProfile } from '@/lib/portfolio-creator-state';
import { loadCreatorSession, CreatorConflictError } from '@/lib/portfolio-creator-store';
import { generatedThesisFileName, renderGeneratedThesisPdf } from '@/lib/thesis-generator';
import { DocumentValidationError, validateThesisDocument } from '@/lib/document-security';

export const runtime = 'nodejs';
const input = z.object({ revision: z.number().int().positive(), confirmed: z.literal(true) }).strict();
export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  const body = await readBoundedJson(req, 8192);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = input.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    const saved = await loadCreatorSession(session.auth.userId);
    if (saved.revision !== parsed.data.revision) throw new CreatorConflictError('The strategy changed. Reload and review the latest draft.');
    const profile = requiredCreatorProfile(saved.state);
    if (!saved.state.draft || !['strategy_ready', 'document_ready'].includes(saved.state.phase)) return NextResponse.json({ error: 'Finish the Portfolio Creator interview before generating its PDF.' }, { status: 422 });
    const draft = attachProfileToDraft(saved.state.draft, profile);
    const pdf = await renderGeneratedThesisPdf({ ...draft, investorProfile: profile });
    const fileName = generatedThesisFileName(draft.title);
    const document = validateThesisDocument({ fileName, mimeType: 'application/pdf', contentBase64: pdf.toString('base64') });
    // Network retries and return visits reuse the saved review instead of creating duplicate drafts.
    if (saved.state.phase === 'document_ready' && saved.state.extractionId) {
      const [extraction] = await db.select().from(externalThesisExtractions).where(and(
        eq(externalThesisExtractions.id, saved.state.extractionId), eq(externalThesisExtractions.ownerId, session.auth.userId), isNull(externalThesisExtractions.dismissedAt)
      )).limit(1);
      if (!extraction || extraction.confirmedAt) return NextResponse.json({ error: 'This review was already approved or removed. Start a new profile to create another strategy.' }, { status: 409 });
      return NextResponse.json({ extraction, session: saved, generatedDocument: { fileName, contentBase64: document.contentBase64 } }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const [latest] = await db.select({ versionNumber: thesisVersions.versionNumber }).from(thesisVersions)
      .where(eq(thesisVersions.ownerId, session.auth.userId)).orderBy(desc(thesisVersions.versionNumber)).limit(1);
    const requestedVersion = (latest?.versionNumber ?? 0) + 1;
    const criteria = ThesisCriteria.parse(criteriaFromPortfolioStrategy(draft, requestedVersion));
    const review = assessThesisReview(criteria);
    if (review.errors.length) return NextResponse.json({ error: 'Correct the strategy before creating its PDF.', review }, { status: 422 });
    const resultJson = ThesisExtractionResult.parse({ criteria, extractionConfidence: 1, ambiguousPoints: [], unmappedContent: [] });
    const result = await db.transaction(async tx => {
      const [fenced] = await tx.update(portfolioCreatorSessions).set({ revision: saved.revision + 1, updatedAt: new Date() })
        .where(and(eq(portfolioCreatorSessions.ownerId, session.auth.userId), eq(portfolioCreatorSessions.revision, saved.revision))).returning();
      if (!fenced) throw new CreatorConflictError('The strategy changed during PDF generation. Reload before continuing.');
      const [extraction] = await tx.insert(externalThesisExtractions).values({
        ownerId: session.auth.userId, externalExtractionId: `portfolio-creator:${randomUUID()}`, status: 'completed', requestedVersion,
        sourceFileName: document.fileName, sourceMimeType: document.mimeType, resultJson, investorProfileJson: profile, completedAt: new Date(),
      }).returning();
      const state = { ...saved.state, phase: 'document_ready' as const, extractionId: extraction.id };
      await tx.update(portfolioCreatorSessions).set({ stateJson: state }).where(eq(portfolioCreatorSessions.ownerId, session.auth.userId));
      return { extraction, session: { revision: saved.revision + 1, state } };
    });
    return NextResponse.json({ ...result, generatedDocument: { fileName, contentBase64: document.contentBase64 } }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof CreatorConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof DocumentValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Unable to create the strategy PDF. Confirm the profile and reload the saved draft before retrying.' }, { status: 422 });
  }
}
