import type { Metadata } from 'next';
import { ResearchInbox } from '@/components/research-inbox';

export const metadata: Metadata = { title: 'Research & Analysis Inbox · Global Portfolio Intelligence' };

export default function ResearchInboxPage() {
  return <ResearchInbox />;
}
