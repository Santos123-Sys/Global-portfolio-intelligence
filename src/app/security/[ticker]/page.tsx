import { Suspense } from 'react';
import { CompanyDashboard } from '@/components/dashboard/company-dashboard';

export default async function SecurityDashboardPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;

  return (
    <Suspense fallback={<div className="dashboard-panel-skeleton" />}>
      <CompanyDashboard ticker={decodeURIComponent(ticker)} />
    </Suspense>
  );
}
