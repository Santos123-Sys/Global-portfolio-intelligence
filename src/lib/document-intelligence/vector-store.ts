import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { documentChunks, documentEmbeddings, intelligenceDocuments } from '../db/workflow-schema';

export async function retrieveVectors(params: { ownerId: string; securityId: string; vector: number[]; limit?: number }) {
  const limit = Math.max(1, Math.min(params.limit ?? 20, 50));
  const vectorLiteral = `[${params.vector.join(',')}]`;
  return db.select({ chunkId: documentChunks.id, documentId: intelligenceDocuments.id, chunkText: documentChunks.chunkText, contextBefore: documentChunks.contextBefore, contextAfter: documentChunks.contextAfter, sectionTitle: documentChunks.sectionTitle, title: intelligenceDocuments.title, source: intelligenceDocuments.source, publishedDate: intelligenceDocuments.publishedDate, isPrimarySource: intelligenceDocuments.isPrimarySource, distance: sql<number>`${documentEmbeddings.embedding} <=> ${vectorLiteral}::vector` }).from(documentEmbeddings).innerJoin(documentChunks, and(eq(documentChunks.id, documentEmbeddings.chunkId), eq(documentChunks.ownerId, params.ownerId), eq(documentChunks.securityId, params.securityId))).innerJoin(intelligenceDocuments, and(eq(intelligenceDocuments.id, documentEmbeddings.documentId), eq(intelligenceDocuments.ownerId, params.ownerId), eq(intelligenceDocuments.securityId, params.securityId))).where(and(eq(documentEmbeddings.ownerId, params.ownerId), eq(documentEmbeddings.securityId, params.securityId), eq(intelligenceDocuments.processingStatus, 'indexed'), isNull(intelligenceDocuments.supersededAt))).orderBy(sql`${documentEmbeddings.embedding} <=> ${vectorLiteral}::vector`).limit(limit);
}
