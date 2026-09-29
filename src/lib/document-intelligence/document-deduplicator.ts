import { createHash } from 'node:crypto';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../db';
import { intelligenceDocuments } from '../db/workflow-schema';

export const computeContentHash = (text: string) => createHash('sha256').update(text).digest('hex');
export async function findDuplicate(ownerId: string, securityId: string, contentHash: string, externalId?: string, excludeId?: string) {
  const scope = [eq(intelligenceDocuments.ownerId, ownerId), eq(intelligenceDocuments.securityId, securityId)];
  if (excludeId) scope.push(ne(intelligenceDocuments.id, excludeId));
  const [byHash] = await db.select({ id: intelligenceDocuments.id }).from(intelligenceDocuments).where(and(...scope, eq(intelligenceDocuments.contentHash, contentHash))).limit(1);
  if (byHash) return byHash;
  if (!externalId) return null;
  const [byExternal] = await db.select({ id: intelligenceDocuments.id }).from(intelligenceDocuments).where(and(...scope, eq(intelligenceDocuments.externalId, externalId), inArray(intelligenceDocuments.processingStatus, ['indexed', 'duplicate']))).limit(1);
  return byExternal ?? null;
}
