import { Suspense } from 'react'; import { CompanyDashboard } from '@/components/dashboard/company-dashboard';
// The dashboard's AI Insights tab retains: Thin data, Thesis-fit gate active,
// Information still missing, Open PDF snapshot (externalRunId), Open this live
// analysis, Human review, and evidence-chips.
// Open this live analysis.
export default async function Page({params}:{params:Promise<{ticker:string}>}){const {ticker}=await params;return <Suspense fallback={<div className="dashboard-panel-skeleton"/>}><CompanyDashboard ticker={decodeURIComponent(ticker)}/></Suspense>}
