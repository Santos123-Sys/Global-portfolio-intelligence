import { desc, eq } from 'drizzle-orm';
import { db } from './db';
import { decisionLog, thesisVersions } from './db/schema';
import { providerCalls } from './db/workflow-schema';

export interface ProviderHealthRow {
  provider: string;
  endpoint: string;
  ok: number;
  errors: number;
  planLimits: number;
  rateLimited: number;
  lastCalledAt: string;
}

export async function buildAdminDashboard(ownerId: string) {
  const [calls, theses, decisions] = await Promise.all([
    db.select().from(providerCalls).orderBy(desc(providerCalls.calledAt)).limit(250),
    db.select().from(thesisVersions).where(eq(thesisVersions.ownerId, ownerId)).orderBy(desc(thesisVersions.versionNumber)),
    db.select().from(decisionLog).where(eq(decisionLog.ownerId, ownerId)).orderBy(desc(decisionLog.decisionDate)).limit(20),
  ]);

  const providerHealth = [...calls.reduce((map, row) => {
    const key = `${row.provider}:${row.endpoint}`;
    const item = map.get(key) ?? {
      provider: row.provider,
      endpoint: row.endpoint,
      ok: 0,
      errors: 0,
      planLimits: 0,
      rateLimited: 0,
      lastCalledAt: row.calledAt.toISOString(),
    };
    if (row.outcome === 'ok') item.ok += 1;
    else if (row.outcome === 'plan_limit') item.planLimits += 1;
    else if (row.outcome === 'rate_limited') item.rateLimited += 1;
    else item.errors += 1;
    map.set(key, item);
    return map;
  }, new Map<string, ProviderHealthRow>()).values()]
    .sort((a, b) => new Date(b.lastCalledAt).getTime() - new Date(a.lastCalledAt).getTime());

  return {
    providerHealth,
    thesisVersions: theses.map((thesis) => ({
      id: thesis.id,
      version: thesis.versionNumber,
      effectiveDate: thesis.effectiveDate.toISOString(),
      supersededAt: thesis.supersededAt?.toISOString() ?? null,
      excludedAt: thesis.excludedAt?.toISOString() ?? null,
    })),
    decisions: decisions.map((decision) => ({
      id: decision.id,
      title: decision.title,
      decision: decision.decision,
      date: decision.decisionDate.toISOString(),
      hasThesisSnapshot: Boolean(decision.metadata?.thesisVersionId),
    })),
  };
}
