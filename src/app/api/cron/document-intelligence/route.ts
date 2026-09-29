import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertCronAuthorized } from '@/lib/env';
import { JOB_TYPES, processQueuedJobs, scheduleWorkspaceJobs } from '@/lib/document-intelligence/job-scheduler';

export const runtime = 'nodejs';
const jobSchema = z.enum(JOB_TYPES);

export async function GET(req: Request) {
  try { assertCronAuthorized(req); } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 401 }); }
  const parsed = jobSchema.safeParse(new URL(req.url).searchParams.get('job') ?? 'incremental');
  if (!parsed.success) return NextResponse.json({ error: 'Unsupported document intelligence job' }, { status: 400 });
  try {
    const scheduled = await scheduleWorkspaceJobs(parsed.data);
    const processed = ['index_maintenance', 'news_sync'].includes(parsed.data) ? [] : await processQueuedJobs();
    return NextResponse.json({ ok: true, job: parsed.data, scheduled, processed });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Document intelligence schedule failed' }, { status: 500 });
  }
}
