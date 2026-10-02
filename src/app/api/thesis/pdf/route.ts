import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { ThesisCriteria } from '@portfolio-intelligence/agentic-contract';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { thesisVersions } from '@/lib/db/schema';
import { validateInvestorProfileSnapshot } from '@/lib/investor-profile';
import { generatedThesisFileName, renderGeneratedThesisPdf, thesisCriteriaToPdfInput } from '@/lib/thesis-generator';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const versionId = new URL(req.url).searchParams.get('versionId');
  if (!versionId) return NextResponse.json({ error: 'A strategy version is required' }, { status: 400 });

  const [version] = await db.select().from(thesisVersions).where(and(
    eq(thesisVersions.id, versionId),
    eq(thesisVersions.ownerId, session.auth.userId),
    isNull(thesisVersions.excludedAt),
  )).limit(1);
  if (!version) return NextResponse.json({ error: 'Strategy version not found' }, { status: 404 });

  try {
    const criteria = ThesisCriteria.parse(version.criteriaJson);
    const input = thesisCriteriaToPdfInput(criteria, session.auth.email);
    const pdf = await renderGeneratedThesisPdf({ ...input, ...(version.investorProfileJson ? { investorProfile: validateInvestorProfileSnapshot(version.investorProfileJson) } : {}) });
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(generatedThesisFileName(input.title))}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Unable to render this strategy version as a PDF' }, { status: 500 });
  }
}
