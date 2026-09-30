import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { sectionData } from '@/lib/company-intelligence';
export const runtime = 'nodejs';
const SECTIONS = new Set(['financials', 'valuation', 'ai-insights', 'risk', 'portfolio', 'documents', 'peers']);
export async function GET(req: Request, { params }: { params: Promise<{ ticker: string; section: string }> }) { const auth = await authenticateRequest(req); if (!auth.ok) return auth.response; const { ticker, section } = await params; if (!SECTIONS.has(section)) return NextResponse.json({ error: 'Not found' }, { status: 404 }); const data = await sectionData(decodeURIComponent(ticker), auth.auth.userId, auth.auth.role === 'viewer', section); return data ? NextResponse.json(data) : NextResponse.json({ error: 'Security not found or unavailable to this account' }, { status: 404 }); }
