import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { dashboardData } from '@/lib/company-intelligence';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) { const auth = await authenticateRequest(req); if (!auth.ok) return auth.response; const { ticker } = await params; const data = await dashboardData(decodeURIComponent(ticker), auth.auth.userId, auth.auth.role === 'viewer'); return data ? NextResponse.json(data) : NextResponse.json({ error: 'Security not found or unavailable to this account' }, { status: 404 }); }
