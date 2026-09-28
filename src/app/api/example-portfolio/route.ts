import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { weightResultSchema } from '@/lib/portfolio-weights';
import { examplePortfolio } from '@/lib/example-portfolio';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 120;
const schema = weightResultSchema.extend({
  data_kind: z.literal('synthetic_educational_example'),
  sample_starting_weights: z.record(z.number().finite()),
  asset_annualized_volatility: z.record(z.number().finite()),
});

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const base = process.env.FILINGS_API_URL;
  const token = process.env.FILINGS_INTERNAL_TOKEN;
  if (!base || !token || token.length < 32) {
    return NextResponse.json({ error: 'The allocation engine is not configured.' }, { status: 503 });
  }
  try {
    const response = await fetch(new URL('/v1/portfolio-weights/example', base), {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(110_000), cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Allocation engine returned ${response.status}`);
    const result = schema.parse(await response.json());
    const assets = examplePortfolio.assets.map(asset => asset.ticker);
    if (Object.keys(result.recommendation.recommended_weights).sort().join('|') !== [...assets].sort().join('|') ||
      Object.keys(result.sample_starting_weights).sort().join('|') !== [...assets].sort().join('|')) {
      throw new Error('Example asset contract mismatch');
    }
    return NextResponse.json({ result }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    console.error('Example portfolio computation failed', error);
    return NextResponse.json({ error: 'The example allocation is temporarily unavailable. Research and analysis remain available.' }, { status: 502 });
  }
}
