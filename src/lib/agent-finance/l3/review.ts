import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { aiAnalyses, portfolios, thesisVersions } from '@/lib/db/schema';
import { discoveryCandidates, externalDiscoveryRuns } from '@/lib/db/workflow-schema';
import type { AgentOutput } from '../contracts';

export async function analysisScopes(ownerId:string,securityId:string) {
  const [existing,candidates]=await Promise.all([
    db.select({portfolioId:aiAnalyses.portfolioId,thesisVersionId:aiAnalyses.thesisVersionId,name:portfolios.name}).from(aiAnalyses)
      .innerJoin(portfolios,eq(portfolios.id,aiAnalyses.portfolioId)).innerJoin(thesisVersions,eq(thesisVersions.id,aiAnalyses.thesisVersionId))
      .where(and(eq(aiAnalyses.ownerId,ownerId),eq(portfolios.ownerId,ownerId),eq(thesisVersions.ownerId,ownerId),eq(aiAnalyses.securityId,securityId),isNull(thesisVersions.excludedAt),isNull(thesisVersions.supersededAt))).orderBy(desc(aiAnalyses.analysisTimestamp)),
    db.select({portfolioId:discoveryCandidates.portfolioId,thesisVersionId:externalDiscoveryRuns.thesisVersionId,name:portfolios.name}).from(discoveryCandidates)
      .innerJoin(externalDiscoveryRuns,eq(externalDiscoveryRuns.id,discoveryCandidates.runId)).innerJoin(portfolios,eq(portfolios.id,discoveryCandidates.portfolioId)).innerJoin(thesisVersions,eq(thesisVersions.id,externalDiscoveryRuns.thesisVersionId))
      .where(and(eq(discoveryCandidates.ownerId,ownerId),eq(discoveryCandidates.securityId,securityId),eq(discoveryCandidates.decision,'approved'),eq(portfolios.ownerId,ownerId),eq(thesisVersions.ownerId,ownerId),isNull(thesisVersions.excludedAt),isNull(thesisVersions.supersededAt))),
  ]);
  return [...new Map([...existing,...candidates].map(row=>[`${row.portfolioId}:${row.thesisVersionId}`,row])).values()];
}
export const reviewSchema=z.object({
  confirmed:z.literal(true), summary:z.string().min(20).max(10000), investmentThesis:z.string().min(20).max(10000),
  portfolioRole:z.string().min(1).max(120), investmentScore:z.number().int().min(0).max(100),thesisAlignmentScore:z.number().int().min(0).max(100),
  qualityScore:z.number().int().min(0).max(100),growthScore:z.number().int().min(0).max(100),riskScore:z.number().int().min(0).max(100),
  keyCatalysts:z.array(z.string().max(2000)).max(30),keyRisks:z.array(z.string().max(2000)).max(30),thesisBreakers:z.array(z.string().max(2000)).max(30),
}).strict();
export function canAcceptReport(report:{status?:string;confidenceScore?:number;outputs?:Record<string,AgentOutput>}) {
  return report.status==='completed' && (report.confidenceScore ?? 0)>=60 && !!report.outputs && Object.values(report.outputs).every(o=>o.status==='completed') && !!report.outputs['judge-agent'];
}
