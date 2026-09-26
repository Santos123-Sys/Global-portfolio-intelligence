import type { SecurityUniverseRecord } from '@portfolio-intelligence/agentic-contract';
import type { WebResearchEvidence } from './web-research.js';

export const DISCOVERY_RESEARCH_GAP = 'Web research could not be retrieved for this security. Business and thesis claims require further verification.';

/** Keep successes from other securities; an outage is never evidence of ineligibility. */
export async function collectDiscoveryResearch(
  universe: SecurityUniverseRecord[],
  research: (companyName: string, ticker: string) => Promise<WebResearchEvidence>,
) {
  const evidence = new Map<string, WebResearchEvidence>();
  const failures = new Set<string>();
  // Sequential calls preserve the provider request budget and rate-limit behavior.
  for (const record of universe) {
    const key = `${record.exchange}:${record.ticker}`;
    if (evidence.has(key) || failures.has(key)) continue;
    try {
      evidence.set(key, await research(record.companyName, record.ticker));
    } catch {
      // Do not persist raw provider errors: they may include request credentials.
      failures.add(key);
    }
  }
  return { evidence, failures };
}
