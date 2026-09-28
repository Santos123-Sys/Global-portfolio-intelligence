import { AgentFinding, buildMarketPlan, marketContextFromRecord, MarketAnalysis, type AgentId, type GroundingBundle } from '@portfolio-intelligence/agentic-contract';

export async function executeMarketAnalysis(bundle: GroundingBundle,
  reason: (agent: AgentId, input: object) => Promise<unknown>): Promise<MarketAnalysis> {
  const plan = buildMarketPlan(bundle.marketContext ?? marketContextFromRecord(bundle), bundle.marketProfiles);
  const evidence: Record<string, unknown> = { ...bundle.fundamentals, ...bundle.computedMetrics, ...bundle.researchEvidence };
  for (const [axis, source] of Object.entries(plan.context.sourceReferences)) {
    evidence[`market:${axis}`] = { value: plan.context[axis as keyof typeof plan.context], source };
  }
  const executions: MarketAnalysis['executions'] = [];
  for (const node of plan.nodes) {
    const dependencies = executions.filter(e => node.dependencies.includes(e.agent));
    if (node.id !== 'RiskAgent' && dependencies.some(d => d.status !== 'complete')) {
      executions.push({ agent: node.id, status: 'blocked', finding: null, detail: `Needs completed evidence from ${dependencies.filter(d => d.status !== 'complete').map(d => d.agent).join(', ')}.` });
      continue;
    }
    if (node.kind === 'engine') {
      executions.push({ agent: node.id, status: 'insufficient_data', finding: null,
        detail: 'Valuation is executed by the deterministic DCF/peer workbench after sourced market inputs and forecast assumptions are reviewed. No model-generated fair value is accepted.' });
      continue;
    }
    if (node.id === 'FinancialStatementAgent' && !Object.keys(bundle.fundamentals).length) {
      executions.push({ agent: node.id, status: 'insufficient_data', finding: null, detail: 'No approved structured financial statements in this research pack.' });
      continue;
    }
    try {
      const finding = AgentFinding.parse(await reason(node.id, { purpose: node.reason, profilePolicies: plan.profiles,
        security: { ticker: bundle.ticker, companyName: bundle.companyName, exchange: bundle.exchange },
        context: plan.context, evidence, dependencies, restrictions: plan.issues }));
      for (const item of [...finding.claims, ...finding.risks]) for (const ref of item.evidenceRefs)
        if (!(ref in evidence)) throw new Error(`Unrecognized evidence reference: ${ref}`);
      if (finding.status === 'complete' && finding.missingInputs.length) throw new Error('Completed module cannot have unresolved required inputs');
      if (finding.status === 'complete' && !finding.claims.length) throw new Error('Completed module requires an evidence-linked finding');
      executions.push({ agent: node.id, status: finding.status, finding, detail: finding.missingInputs.join('; ') });
    } catch (error) {
      executions.push({ agent: node.id, status: 'error', finding: null,
        detail: error instanceof Error && /Unrecognized evidence|Completed module/.test(error.message) ? error.message : 'Module failed or returned an invalid evidence contract; review required.' });
    }
  }
  const conflicts: MarketAnalysis['conflicts'] = [];
  const risks = executions.flatMap(e => e.finding?.risks ?? []);
  for (const risk of risks) if (risk.direction === 'increase' && risks.some(r => r.assumption === risk.assumption && r.scenario === risk.scenario && r.direction === 'decrease')) {
    if (!conflicts.some(c => c.code === `${risk.assumption}:${risk.scenario}`)) conflicts.push({
      code: `${risk.assumption}:${risk.scenario}`, severity: 'WARN', detail: `Agents disagree on ${risk.assumption} in ${risk.scenario}. Retain both explanations and review the scenario.`, sourceReferences: [...new Set(risks.filter(r => r.assumption === risk.assumption && r.scenario === risk.scenario).flatMap(r => r.evidenceRefs))],
    });
  }
  return MarketAnalysis.parse({ plan, executions, conflicts, generatedAt: new Date().toISOString() });
}
