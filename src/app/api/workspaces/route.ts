import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { companyWorkspaces } from '@/lib/db/workflow-schema';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const securityId = new URL(req.url).searchParams.get('securityId');
  const rows = await db.select().from(companyWorkspaces).where(eq(companyWorkspaces.ownerId, session.auth.userId));
  return NextResponse.json({ workspaces: securityId ? rows.filter((row) => row.securityId === securityId) : rows });
}
