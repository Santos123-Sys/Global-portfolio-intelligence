import { getEnv } from '../env';
import { embedTexts } from './gemini-embedding';
export async function embedDocumentChunks(chunks: string[]): Promise<number[][]> { const size = getEnv().EMBEDDING_BATCH_SIZE; const output: number[][] = []; for (let index = 0; index < chunks.length; index += size) output.push(...await embedTexts(chunks.slice(index, index + size), 'RETRIEVAL_DOCUMENT')); return output; }
