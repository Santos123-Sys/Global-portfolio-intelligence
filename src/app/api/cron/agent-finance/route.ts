import { NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/env';
import { processQueuedSessions } from '@/lib/agent-finance/l1/research-director';
export const runtime = 'nodejs';
export const maxDuration = 600;
export async function POST(req: Request) {
  try { assertCronAuthorized(req); } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  return NextResponse.json({ processed: await processQueuedSessions() });
}
