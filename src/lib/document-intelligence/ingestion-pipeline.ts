import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { getEnv } from '../env';
import { companyWorkspaces, documentChunks, documentEmbeddings, ingestionJobs, intelligenceDocuments } from '../db/workflow-schema';
import { chunkDocument } from './chunking-engine';
import { computeContentHash, findDuplicate } from './document-deduplicator';
import { downloadDocument } from './document-downloader';
import { MarketAdaptiveDiscovery } from './document-discovery';
import { parseDocument } from './document-parser';
import { embedDocumentChunks } from './embedding-batcher';
import { EMBEDDING_MODEL } from './gemini-embedding';
import { getDocumentStorage } from './document-storage';
import { createDocumentAlert } from './alerts/document-alerts';
import { classifyMonitoredEvents, publishMonitoredEventAlerts } from './alerts/event-monitoring';
import type { DiscoveredDocument } from './types';

const storageKey = (ownerId: string, securityId: string, documentId: string, filename: string) => `${ownerId}/${securityId}/${documentId}/${filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(-160)}`;

export async function indexTextDocument(params: { documentId: string; workspaceId: string; securityId: string; ownerId: string; text: string }) {
  const chunks = chunkDocument(params.text, getEnv().CHUNK_TARGET_SIZE); if (!chunks.length) throw new Error('Document did not produce any valid semantic chunks');
  const embeddings = await embedDocumentChunks(chunks.map((chunk) => chunk.text));
  await db.transaction(async (tx) => {
    const inserted = await tx.insert(documentChunks).values(chunks.map((chunk) => ({ documentId: params.documentId, workspaceId: params.workspaceId, securityId: params.securityId, ownerId: params.ownerId, chunkIndex: chunk.index, chunkText: chunk.text, chunkLength: chunk.length, contextBefore: chunk.contextBefore, contextAfter: chunk.contextAfter, sectionTitle: chunk.sectionTitle, sectionType: chunk.sectionType, chunkHash: chunk.hash, embeddingStatus: 'embedded', embeddedAt: new Date() }))).returning({ id: documentChunks.id });
    await tx.insert(documentEmbeddings).values(inserted.map((chunk, index) => ({ chunkId: chunk.id, documentId: params.documentId, workspaceId: params.workspaceId, securityId: params.securityId, ownerId: params.ownerId, embedding: embeddings[index], embeddingModel: EMBEDDING_MODEL })));
    await tx.update(intelligenceDocuments).set({ processingStatus: 'indexed', processingError: null, processedAt: new Date() }).where(and(eq(intelligenceDocuments.id, params.documentId), eq(intelligenceDocuments.ownerId, params.ownerId), eq(intelligenceDocuments.securityId, params.securityId)));
    await tx.update(companyWorkspaces).set({ lastIngestedAt: new Date(), documentCount: sql`${companyWorkspaces.documentCount} + 1`, chunkCount: sql`${companyWorkspaces.chunkCount} + ${chunks.length}`, ragEnabled: true }).where(and(eq(companyWorkspaces.id, params.workspaceId), eq(companyWorkspaces.ownerId, params.ownerId), eq(companyWorkspaces.securityId, params.securityId)));
  });
  return chunks.length;
}

export async function ingestDocument(workspace: typeof companyWorkspaces.$inferSelect, discovered: DiscoveredDocument, retryDocumentId?: string) {
  const [record] = retryDocumentId
    ? await db.update(intelligenceDocuments).set({ processingStatus: 'downloading', processingError: null }).where(and(eq(intelligenceDocuments.id, retryDocumentId), eq(intelligenceDocuments.workspaceId, workspace.id), eq(intelligenceDocuments.ownerId, workspace.ownerId), eq(intelligenceDocuments.securityId, workspace.securityId))).returning()
    : await db.insert(intelligenceDocuments).values({ workspaceId: workspace.id, securityId: workspace.securityId, ownerId: workspace.ownerId, folderType: discovered.folderType, documentType: discovered.documentType, source: discovered.source, title: discovered.title, description: discovered.description, url: discovered.url, externalId: discovered.externalId, publishedDate: discovered.publishedDate ? new Date(discovered.publishedDate) : null, fiscalYearEnd: /^\d{4}-\d{2}-\d{2}$/.test(discovered.fiscalYearEnd ?? '') ? discovered.fiscalYearEnd : null, fiscalPeriod: discovered.fiscalPeriod, isPrimarySource: discovered.isPrimarySource, isAmendment: discovered.isAmendment ?? false, metadataJson: discovered.metadata, processingStatus: 'downloading' }).returning();
  if (!record) throw new Error('Retry document is outside the workspace scope');
  try {
    const downloaded = await downloadDocument(discovered.url);
    await db.update(intelligenceDocuments).set({ processingStatus: 'parsing' }).where(and(eq(intelligenceDocuments.id, record.id), eq(intelligenceDocuments.ownerId, workspace.ownerId), eq(intelligenceDocuments.securityId, workspace.securityId)));
    const parsed = await parseDocument(downloaded.bytes, downloaded.contentType, downloaded.filename);
    const contentHash = computeContentHash(parsed.text);
    const duplicate = await findDuplicate(workspace.ownerId, workspace.securityId, contentHash, discovered.externalId, record.id);
    if (duplicate && duplicate.id !== record.id) { await db.update(intelligenceDocuments).set({ contentHash, processingStatus: 'duplicate', processedAt: new Date() }).where(and(eq(intelligenceDocuments.id, record.id), eq(intelligenceDocuments.ownerId, workspace.ownerId), eq(intelligenceDocuments.securityId, workspace.securityId))); return { indexed: false, chunks: 0, duplicate: true, events: [] }; }
    await db.update(intelligenceDocuments).set({ processingStatus: 'chunking' }).where(and(eq(intelligenceDocuments.id, record.id), eq(intelligenceDocuments.ownerId, workspace.ownerId), eq(intelligenceDocuments.securityId, workspace.securityId)));
    const chunks = chunkDocument(parsed.text, getEnv().CHUNK_TARGET_SIZE);
    if (!chunks.length) throw new Error('Document did not produce any valid semantic chunks');
    await db.update(intelligenceDocuments).set({ processingStatus: 'embedding' }).where(and(eq(intelligenceDocuments.id, record.id), eq(intelligenceDocuments.ownerId, workspace.ownerId), eq(intelligenceDocuments.securityId, workspace.securityId)));
    const embeddings = await embedDocumentChunks(chunks.map((chunk) => chunk.text));
    const key = storageKey(workspace.ownerId, workspace.securityId, record.id, downloaded.filename);
    await getDocumentStorage().upload(key, downloaded.bytes, { contentType: downloaded.contentType, sourceUrl: discovered.url });
    await db.transaction(async (tx) => {
      let amendedDocumentId: string | null = null;
      if (discovered.isAmendment) {
        const baseType = discovered.documentType.replace(/\/A$/, '');
        const [original] = await tx.select({ id: intelligenceDocuments.id }).from(intelligenceDocuments).where(and(eq(intelligenceDocuments.ownerId, workspace.ownerId), eq(intelligenceDocuments.securityId, workspace.securityId), eq(intelligenceDocuments.documentType, baseType), eq(intelligenceDocuments.processingStatus, 'indexed'))).limit(1);
        if (original) { amendedDocumentId = original.id; await tx.update(intelligenceDocuments).set({ supersededAt: new Date() }).where(and(eq(intelligenceDocuments.id, original.id), eq(intelligenceDocuments.ownerId, workspace.ownerId), eq(intelligenceDocuments.securityId, workspace.securityId))); }
      }
      const inserted = await tx.insert(documentChunks).values(chunks.map((chunk) => ({ documentId: record.id, workspaceId: workspace.id, securityId: workspace.securityId, ownerId: workspace.ownerId, chunkIndex: chunk.index, chunkText: chunk.text, chunkLength: chunk.length, contextBefore: chunk.contextBefore, contextAfter: chunk.contextAfter, sectionTitle: chunk.sectionTitle, sectionType: chunk.sectionType, chunkHash: chunk.hash, embeddingStatus: 'embedded', embeddedAt: new Date() }))).returning({ id: documentChunks.id });
      await tx.insert(documentEmbeddings).values(inserted.map((chunk, index) => ({ chunkId: chunk.id, documentId: record.id, workspaceId: workspace.id, securityId: workspace.securityId, ownerId: workspace.ownerId, embedding: embeddings[index], embeddingModel: EMBEDDING_MODEL })));
      await tx.update(intelligenceDocuments).set({ localPath: key, contentHash, contentText: parsed.text, contentLength: parsed.text.length, pageCount: parsed.pageCount, fileFormat: parsed.format, processingStatus: 'indexed', processingError: null, processedAt: new Date(), amendedDocumentId }).where(and(eq(intelligenceDocuments.id, record.id), eq(intelligenceDocuments.ownerId, workspace.ownerId), eq(intelligenceDocuments.securityId, workspace.securityId)));
      await tx.update(companyWorkspaces).set({ lastIngestedAt: new Date(), documentCount: sql`${companyWorkspaces.documentCount} + 1`, chunkCount: sql`${companyWorkspaces.chunkCount} + ${chunks.length}`, ragEnabled: true, status: 'active' }).where(and(eq(companyWorkspaces.id, workspace.id), eq(companyWorkspaces.ownerId, workspace.ownerId), eq(companyWorkspaces.securityId, workspace.securityId)));
    });
    return { indexed: true, chunks: chunks.length, duplicate: false, events: classifyMonitoredEvents({ ...discovered, contentText: parsed.text }) };
  } catch (error) {
    await db.update(intelligenceDocuments).set({ processingStatus: sql`case when ${intelligenceDocuments.retryCount} + 1 >= 3 then 'permanent_failure' else 'failed' end`, processingError: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown ingestion failure', retryCount: sql`${intelligenceDocuments.retryCount} + 1` }).where(and(eq(intelligenceDocuments.id, record.id), eq(intelligenceDocuments.ownerId, workspace.ownerId), eq(intelligenceDocuments.securityId, workspace.securityId)));
    throw error;
  }
}

export async function ingestUploadedDocument(
  workspace: typeof companyWorkspaces.$inferSelect,
  input: { bytes: Buffer; filename: string; contentType: string; title: string; folderType: string; documentType: string; publishedDate?: Date | null }
) {
  if (input.bytes.byteLength > 50 * 1024 * 1024) throw new Error('Document exceeds the 50 MB upload limit');
  const parsed = await parseDocument(input.bytes, input.contentType, input.filename);
  const contentHash = computeContentHash(parsed.text);
  const duplicate = await findDuplicate(workspace.ownerId, workspace.securityId, contentHash);
  if (duplicate) return { indexed: false, duplicate: true, documentId: duplicate.id, chunks: 0, events: [] };
  const [record] = await db.insert(intelligenceDocuments).values({
    workspaceId: workspace.id, securityId: workspace.securityId, ownerId: workspace.ownerId,
    folderType: input.folderType, documentType: input.documentType, source: 'manual_upload',
    title: input.title, publishedDate: input.publishedDate ?? null, contentHash, processingStatus: 'embedding',
    isPrimarySource: false,
  }).returning();
  const key = storageKey(workspace.ownerId, workspace.securityId, record.id, input.filename);
  try {
    await getDocumentStorage().upload(key, input.bytes, { contentType: input.contentType });
    const chunks = chunkDocument(parsed.text, getEnv().CHUNK_TARGET_SIZE);
    if (!chunks.length) throw new Error('Document did not produce any valid semantic chunks');
    const embeddings = await embedDocumentChunks(chunks.map((chunk) => chunk.text));
    await db.transaction(async (tx) => {
      const inserted = await tx.insert(documentChunks).values(chunks.map((chunk) => ({ documentId: record.id, workspaceId: workspace.id, securityId: workspace.securityId, ownerId: workspace.ownerId, chunkIndex: chunk.index, chunkText: chunk.text, chunkLength: chunk.length, contextBefore: chunk.contextBefore, contextAfter: chunk.contextAfter, sectionTitle: chunk.sectionTitle, sectionType: chunk.sectionType, chunkHash: chunk.hash, embeddingStatus: 'embedded', embeddedAt: new Date() }))).returning({ id: documentChunks.id });
      await tx.insert(documentEmbeddings).values(inserted.map((chunk, index) => ({ chunkId: chunk.id, documentId: record.id, workspaceId: workspace.id, securityId: workspace.securityId, ownerId: workspace.ownerId, embedding: embeddings[index], embeddingModel: EMBEDDING_MODEL })));
      await tx.update(intelligenceDocuments).set({ localPath: key, contentText: parsed.text, contentLength: parsed.text.length, pageCount: parsed.pageCount, fileFormat: parsed.format, processingStatus: 'indexed', processedAt: new Date() }).where(and(eq(intelligenceDocuments.id, record.id), eq(intelligenceDocuments.ownerId, workspace.ownerId), eq(intelligenceDocuments.securityId, workspace.securityId)));
      await tx.update(companyWorkspaces).set({ lastIngestedAt: new Date(), documentCount: sql`${companyWorkspaces.documentCount} + 1`, chunkCount: sql`${companyWorkspaces.chunkCount} + ${chunks.length}`, ragEnabled: true }).where(and(eq(companyWorkspaces.id, workspace.id), eq(companyWorkspaces.ownerId, workspace.ownerId), eq(companyWorkspaces.securityId, workspace.securityId)));
    });
    const evidence = { folderType: input.folderType, documentType: input.documentType, title: input.title, contentText: parsed.text, source: 'manual_upload' };
    const events = classifyMonitoredEvents(evidence);
    await publishMonitoredEventAlerts({ ownerId: workspace.ownerId, securityId: workspace.securityId, ticker: workspace.ticker, evidence, events });
    return { indexed: true, duplicate: false, documentId: record.id, chunks: chunks.length, events };
  } catch (error) {
    await getDocumentStorage().delete(key).catch(() => undefined);
    await db.update(intelligenceDocuments).set({ processingStatus: 'failed', processingError: error instanceof Error ? error.message.slice(0, 1000) : 'Upload ingestion failed', retryCount: 1 }).where(and(eq(intelligenceDocuments.id, record.id), eq(intelligenceDocuments.ownerId, workspace.ownerId), eq(intelligenceDocuments.securityId, workspace.securityId)));
    throw error;
  }
}

export async function runIngestionJob(jobId: string, ownerId: string, securityId: string) {
  const [job] = await db.select().from(ingestionJobs).where(and(eq(ingestionJobs.id, jobId), eq(ingestionJobs.ownerId, ownerId), eq(ingestionJobs.securityId, securityId))).limit(1);
  if (!job) throw new Error('Ingestion job not found');
  const [workspace] = await db.select().from(companyWorkspaces).where(and(eq(companyWorkspaces.id, job.workspaceId), eq(companyWorkspaces.ownerId, ownerId), eq(companyWorkspaces.securityId, securityId))).limit(1);
  if (!workspace) throw new Error('Workspace not found');
  const logs = [...(job.logJson ?? []), `Started at ${new Date().toISOString()}`];
  await db.update(ingestionJobs).set({ status: 'running', startedAt: new Date(), errorMessage: null, logJson: logs }).where(and(eq(ingestionJobs.id, job.id), eq(ingestionJobs.ownerId, ownerId), eq(ingestionJobs.securityId, securityId)));
  try {
    const documents: DiscoveredDocument[] = job.jobType === 'retry_failed'
      ? (await db.select().from(intelligenceDocuments).where(and(eq(intelligenceDocuments.workspaceId, workspace.id), eq(intelligenceDocuments.ownerId, ownerId), eq(intelligenceDocuments.securityId, securityId), eq(intelligenceDocuments.processingStatus, 'failed')))).filter((document) => document.retryCount < 3 && Boolean(document.url)).map((document) => ({ documentType: document.documentType, externalId: document.externalId ?? undefined, title: document.title, description: document.description ?? undefined, publishedDate: document.publishedDate?.toISOString(), fiscalYearEnd: document.fiscalYearEnd ?? undefined, fiscalPeriod: document.fiscalPeriod ?? undefined, url: document.url!, source: document.source, isPrimarySource: document.isPrimarySource, folderType: document.folderType as DiscoveredDocument['folderType'], isAmendment: document.isAmendment ?? false, metadata: { ...(document.metadataJson as Record<string, unknown> | null), retryDocumentId: document.id } }))
      : await new MarketAdaptiveDiscovery().discover(workspace.ticker, workspace.exchange, workspace.country ?? '');
    let ingested = 0; let chunks = 0; const errors: string[] = []; let cursor = 0;
    const workers = Array.from({ length: Math.min(getEnv().MAX_CONCURRENT_DOWNLOADS, documents.length) }, async () => {
      while (cursor < documents.length) {
        const document = documents[cursor++];
        try { const result = await ingestDocument(workspace, document, typeof document.metadata?.retryDocumentId === 'string' ? document.metadata.retryDocumentId : undefined); if (result.indexed) { ingested++; chunks += result.chunks; await publishMonitoredEventAlerts({ ownerId, securityId, ticker: workspace.ticker, evidence: document, events: result.events }); if (document.folderType === 'MATERIAL_FACT' && result.events.length === 0) await createDocumentAlert({ ownerId, securityId, headline: `${workspace.ticker}: new material disclosure`, detail: document.title, severity: 'watch' }); } }
        catch (error) { errors.push(`${document.title}: ${error instanceof Error ? error.message : 'failed'}`); }
      }
    });
    await Promise.all(workers);
    await db.update(ingestionJobs).set({ status: errors.length && !ingested ? 'failed' : 'completed', completedAt: new Date(), documentsDiscovered: documents.length, documentsIngested: ingested, chunksCreated: chunks, chunksEmbedded: chunks, errorMessage: errors.length ? errors.join('; ').slice(0, 2000) : null, logJson: [...logs, ...errors, `Completed: ${ingested}/${documents.length} documents indexed`] }).where(and(eq(ingestionJobs.id, job.id), eq(ingestionJobs.ownerId, ownerId), eq(ingestionJobs.securityId, securityId)));
    return { discovered: documents.length, ingested, chunks, errors };
  } catch (error) {
    await db.update(ingestionJobs).set({ status: 'failed', completedAt: new Date(), errorMessage: error instanceof Error ? error.message : 'Job failed', logJson: [...logs, `Failed: ${error instanceof Error ? error.message : 'unknown'}`] }).where(and(eq(ingestionJobs.id, job.id), eq(ingestionJobs.ownerId, ownerId), eq(ingestionJobs.securityId, securityId)));
    throw error;
  }
}
