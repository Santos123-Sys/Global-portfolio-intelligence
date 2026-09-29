import { GEMINI_MODEL, generateGroundedAnswer } from '../gemini-client';
import type { RAGAnswer } from '../types';
import { validateAnswerCitations } from './answer-parser';
import { ensureConversation, saveExchange } from './conversation-store';
import { buildRagPrompt } from './prompt-builder';
import { retrieveContext } from './retrieval';

export async function askWorkspace(params: { question: string; workspaceId: string; securityId: string; ownerId: string; userId: string; conversationId?: string }): Promise<RAGAnswer> {
  const chunks = await retrieveContext(params.ownerId, params.securityId, params.question);
  const conversation = await ensureConversation({ ...params });
  if (!chunks.length) { const answer = 'I cannot find information about this in the available documents.'; await saveExchange({ conversationId: conversation.id, ownerId: params.ownerId, securityId: params.securityId, question: params.question, answer, citations: [], retrieved: [], model: GEMINI_MODEL }); return { answer, citations: [], conversationId: conversation.id }; }
  const result = await generateGroundedAnswer(buildRagPrompt(params.question, chunks));
  const answer = validateAnswerCitations(result.answer, chunks.length);
  const citations = chunks.map((chunk) => ({ chunkId: chunk.chunkId, documentId: chunk.documentId, documentTitle: chunk.title, source: chunk.source, publishedDate: chunk.publishedDate?.toISOString() ?? '', excerpt: chunk.chunkText.slice(0, 500), relevanceScore: chunk.relevanceScore, isPrimarySource: chunk.isPrimarySource }));
  await saveExchange({ conversationId: conversation.id, ownerId: params.ownerId, securityId: params.securityId, question: params.question, answer, citations, retrieved: chunks.map(({ distance, relevanceScore, chunkId, documentId }) => ({ distance, relevanceScore, chunkId, documentId })), promptTokens: result.promptTokens, completionTokens: result.completionTokens, model: GEMINI_MODEL });
  return { answer, citations, conversationId: conversation.id };
}
