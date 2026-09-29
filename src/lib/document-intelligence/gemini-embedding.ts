import { getEnv } from '../env';

export const EMBEDDING_MODEL = 'text-embedding-004';
export async function embedTexts(texts: string[], taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[][]> {
  if (!texts.length) return [];
  const env = getEnv(); if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required for document intelligence');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requests: texts.map((text) => ({ model: `models/${EMBEDDING_MODEL}`, taskType, content: { parts: [{ text }] } })) }), signal: AbortSignal.timeout(30_000), cache: 'no-store' });
  if (!response.ok) throw new Error(`Gemini embedding failed (${response.status})`);
  const payload = await response.json() as { embeddings?: Array<{ values?: number[] }> };
  const embeddings = payload.embeddings?.map((entry) => entry.values ?? []) ?? [];
  if (embeddings.length !== texts.length || embeddings.some((entry) => entry.length !== 768 || entry.some((value) => !Number.isFinite(value)))) throw new Error('Gemini returned invalid embedding dimensions');
  return embeddings;
}
