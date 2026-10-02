import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { portfolioCreatorSessions } from './db/workflow-schema';
import { emptyCreatorState, PortfolioCreatorState, type CreatorSession } from './portfolio-creator-state';

export class CreatorConflictError extends Error {}
export async function loadCreatorSession(ownerId: string): Promise<CreatorSession> {
  const [row] = await db.select().from(portfolioCreatorSessions).where(eq(portfolioCreatorSessions.ownerId, ownerId)).limit(1);
  return row ? { revision: row.revision, state: PortfolioCreatorState.parse(row.stateJson) } : { revision: 0, state: emptyCreatorState() };
}
export async function saveCreatorSession(ownerId: string, revision: number, state: PortfolioCreatorState): Promise<CreatorSession> {
  const validated = PortfolioCreatorState.parse(state);
  // A revision-0 session has not been persisted yet. Unique owner keys resolve first-write races.
  const rows = revision === 0
    ? await db.insert(portfolioCreatorSessions).values({ ownerId, revision: 1, stateJson: validated })
      .onConflictDoNothing({ target: portfolioCreatorSessions.ownerId }).returning()
    : await db.update(portfolioCreatorSessions).set({ revision: revision + 1, stateJson: validated, updatedAt: new Date() })
      .where(and(eq(portfolioCreatorSessions.ownerId, ownerId), eq(portfolioCreatorSessions.revision, revision))).returning();
  if (!rows.length) throw new CreatorConflictError('Portfolio Creator changed in another request. Reload the saved conversation before continuing.');
  return { revision: rows[0].revision, state: rows[0].stateJson };
}
