import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { accountCanEdit } from '@/lib/account-scope';
import { readBoundedJson } from '@/lib/request-body';
import { enqueue, listJobs, loadWorkspace, QueueError, saveWorkspace } from '@/lib/foundation/store';
import { ZodError } from 'zod';
export const runtime = 'nodejs';
const headers = { 'cache-control': 'no-store' };
async function access(req: Request, mutate = false) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session;
  if (mutate) {
    try { assertSameOrigin(req); } catch { return { ok: false as const, response: NextResponse.json({ error: 'Same-origin request required' }, { status: 403, headers }) }; }
    if (!accountCanEdit(session.auth.role)) return { ok: false as const, response: NextResponse.json({ error: 'Read-only membership' }, { status: 403, headers }) };
  }
  return session;
}
export async function GET(req: Request) {
  const session = await access(req);
  if (!session.ok) return session.response;
  try {
    const [workspace, jobs] = await Promise.all([loadWorkspace(session.auth.userId), listJobs(session.auth.userId)]);
    return NextResponse.json({ workspace, jobs, integrations: { finance: process.env.FILINGLENS_READ_ENABLED === 'true' ? 'configured_read_attempts' : 'disabled',
      researchModel: process.env.RESEARCH_MODEL_ENABLED === 'true' ? 'enabled' : 'disabled', valuationAuthority: 'FilingLens' } }, { headers });
  } catch { return NextResponse.json({ error: 'Workspace unavailable. Verify database configuration and foundation migration.' }, { status: 503, headers }); }
}
export async function PUT(req: Request) {
  const session = await access(req, true); if (!session.ok) return session.response;
  const body = await readBoundedJson(req, 128_000); if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  try { return NextResponse.json({ workspace: await saveWorkspace(session.auth.userId, body.value) }, { headers }); }
  catch (e) { return NextResponse.json({ error: e instanceof ZodError ? 'Invalid USA/CVM workspace' : 'Save unavailable' }, { status: e instanceof ZodError ? 422 : 503, headers }); }
}
export async function POST(req: Request) {
  const session = await access(req, true); if (!session.ok) return session.response;
  const body = await readBoundedJson(req, 128_000); if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  try { return NextResponse.json(await enqueue(session.auth.userId, body.value), { status: 202, headers }); }
  catch (e) { const status = e instanceof ZodError ? 422 : e instanceof QueueError ? (e.code === 'idempotency_conflict' ? 409 : 429) : 503;
    return NextResponse.json({ error: e instanceof QueueError ? e.code : e instanceof ZodError ? 'Invalid job request' : 'Queue unavailable' }, { status, headers }); }
}
