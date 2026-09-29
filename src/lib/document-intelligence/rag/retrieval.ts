import { embedTexts } from '../gemini-embedding';
import { retrieveVectors } from '../vector-store';
import { rerank } from './reranker';
export async function retrieveContext(ownerId: string, securityId: string, question: string, limit = 8) { const [queryVector] = await embedTexts([question], 'RETRIEVAL_QUERY'); const candidates = await retrieveVectors({ ownerId, securityId, vector: queryVector, limit: 20 }); return rerank(candidates, question).slice(0, limit); }
