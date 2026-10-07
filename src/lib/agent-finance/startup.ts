import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { agentAnalysisSessions, agentEvaluationJobs } from '@/lib/db/agent-schema';

/** Readiness checks must finish before the private worker reports healthy. */
export async function initializeFinanceRuntime(): Promise<void> {
  getEnv();
  // Empty reads check connectivity, schema and SELECT permissions without
  // loading issuer content, claiming jobs or paying for model requests.
  await db.execute(sql`select 1 from ${agentAnalysisSessions} limit 0`);
  await db.execute(sql`select 1 from ${agentEvaluationJobs} limit 0`);
}
