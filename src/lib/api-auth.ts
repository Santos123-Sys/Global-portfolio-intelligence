import { NextResponse } from 'next/server';
import { getOptionalSession } from './auth';
export async function authenticateRequest(req: Request) {
  try {
    const auth = await getOptionalSession(req);
    if (auth) return { ok: true as const, auth };
    return { ok: false as const, response: NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: { 'cache-control': 'no-store' } }) };
  } catch {
    return { ok: false as const, response: NextResponse.json({ error: 'Authentication service unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } }) };
  }
}
