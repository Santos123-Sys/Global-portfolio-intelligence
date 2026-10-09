import type { Metadata } from 'next';
import './globals.css';
// Per-request CSP nonces cannot be applied to prerendered HTML.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'GPI · Discovery & Research', description: 'USA and Brazil CVM equity research, grounded in FilingLens.' };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
