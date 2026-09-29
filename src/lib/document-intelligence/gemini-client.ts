import { getEnv } from '../env';
export const GEMINI_MODEL = 'gemini-1.5-flash';
export async function generateGroundedAnswer(prompt: string) {
  const key = getEnv().GEMINI_API_KEY; if (!key) throw new Error('GEMINI_API_KEY is required for document intelligence');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 2048, topP: 0.95, topK: 40 } }), signal: AbortSignal.timeout(45_000), cache: 'no-store' });
  if (!response.ok) throw new Error(`Gemini RAG generation failed (${response.status})`);
  const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
  const answer = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim(); if (!answer) throw new Error('Gemini returned an empty RAG answer');
  return { answer, promptTokens: body.usageMetadata?.promptTokenCount, completionTokens: body.usageMetadata?.candidatesTokenCount };
}
