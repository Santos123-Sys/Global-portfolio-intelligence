import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { readBoundedJson } from '@/lib/request-body';

export const runtime = 'nodejs';
const requestSchema = z.object({ targetLanguage: z.enum(['pt-BR', 'es', 'de']), texts: z.array(z.string().min(1).max(10_000)).min(1).max(250) }).strict();
const cache = new Map<string, string>();

export async function POST(request: Request) {
  const session = await authenticateRequest(request);
  if (!session.ok) return session.response;
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: 'invalid_origin' }, { status: 403 }); }
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  const body = await readBoundedJson(request, 450 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = requestSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const { targetLanguage, texts } = parsed.data;
  if (texts.reduce((count, text) => count + text.length, 0) > 100_000) return NextResponse.json({ error: 'request_too_large' }, { status: 413 });
  const missing = texts.filter((text) => !cache.has(`${targetLanguage}\u0000${text}`));
  if (missing.length) {
    const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: missing, target: targetLanguage, format: 'text' }), signal: AbortSignal.timeout(15_000), cache: 'no-store' }).catch(() => null);
    const payload = response?.ok ? await response.json().catch(() => null) as { data?: { translations?: Array<{ translatedText?: string }> } } | null : null;
    const translations = payload?.data?.translations;
    if (!translations || translations.length !== missing.length || translations.some((item) => typeof item.translatedText !== 'string')) return NextResponse.json({ error: 'translation_failed' }, { status: 502 });
    missing.forEach((text, index) => cache.set(`${targetLanguage}\u0000${text}`, translations[index].translatedText!));
    while (cache.size > 8_000) cache.delete(cache.keys().next().value!);
  }
  return NextResponse.json({ translations: texts.map((text) => ({ translatedText: cache.get(`${targetLanguage}\u0000${text}`)! })) }, { headers: { 'cache-control': 'private, no-store' } });
}
