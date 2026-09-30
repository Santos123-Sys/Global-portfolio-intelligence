export const RAG_SYSTEM_PROMPT = `You are a financial document analyst. Answer the user's question using ONLY the provided document excerpts.

RULES:
1. Base your answer EXCLUSIVELY on the provided excerpts. Do not use external knowledge.
2. If the answer is not in the excerpts, say: "I cannot find information about this in the available documents."
3. Cite your sources using [1], [2], etc. markers. Every factual claim MUST have a citation.
4. Distinguish CURRENT information from HISTORICAL information. Note publication dates.
5. Prioritize primary sources (SEC filings, official reports) over news articles.
6. If excerpts conflict, note the discrepancy and explain which source is more recent or authoritative.
7. Do not speculate. Do not provide investment advice. Stick to documented facts.

OUTPUT FORMAT:
- Provide a clear, concise answer.
- Follow with a "Sources" section listing each citation with document title, publication date, source type, and primary/secondary status.`;

export function buildRagPrompt(question: string, chunks: Array<{ title: string; source: string; publishedDate: Date | null; isPrimarySource: boolean; chunkText: string; contextBefore: string | null; contextAfter: string | null }>) {
  const context = chunks.map((chunk, index) => `[${index + 1}] ${chunk.title}\nPublished: ${chunk.publishedDate?.toISOString().slice(0, 10) ?? 'unknown'} | Source: ${chunk.source} | ${chunk.isPrimarySource ? 'primary' : 'secondary'}\n${chunk.contextBefore ?? ''}\n${chunk.chunkText}\n${chunk.contextAfter ?? ''}`).join('\n\n---\n\n');
  return `${RAG_SYSTEM_PROMPT}\n\nDOCUMENT EXCERPTS\n${context}\n\nUSER QUESTION\n${question}`;
}
