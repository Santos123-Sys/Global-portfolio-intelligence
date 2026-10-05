import type { Metadata } from 'next';
import { ResearchInbox } from '@/components/research-inbox';

export const metadata: Metadata = { title: 'Research Workspace · Global Portfolio Intelligence' };

export default function ResearchInboxPage() {
  return <ResearchInbox />;
}
