import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import './platform-v2.css';
import './agent-console-v2.css';
import './commercial-v3.css';
import './commercial-v3-overrides.css';
import { AppShell } from '@/components/app-shell';

export const metadata: Metadata = {
  title: 'Global Portfolio Intelligence',
  description: 'Evidence-led investment research, valuation and portfolio monitoring across global markets.',
  icons: {
    icon: '/brand/portfolio-intelligence-mark.svg',
    apple: '/brand/portfolio-intelligence-mark.svg',
  },
};

/**
 * Without this the browser assumes a desktop-width layout and scales the whole
 * page down on a phone: text becomes unreadable, and every tap target shrinks
 * below the size a thumb can hit. maximumScale and userScalable are deliberately
 * left at their defaults so readers can still zoom financial detail.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Nonce-based CSP requires request-time rendering so Next can apply the
  // proxy-provided nonce to its bootstrap scripts.
  await headers();
  return (
    <html lang="en">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
