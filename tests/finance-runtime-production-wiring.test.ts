import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const railway = readFileSync('.railway/railway.ts', 'utf8');
const worker = readFileSync('services/agentic/src/worker.ts', 'utf8');
const workerConfig = readFileSync('services/agentic/src/config.ts', 'utf8');
const buildRuntime = readFileSync('scripts/build-finance-runtime.mjs', 'utf8');

describe('canonical finance runtime production wiring', () => {
  it('builds the governed finance runtime into the agentic worker', () => {
    expect(buildRuntime).toContain("src/lib/agent-finance/l1/research-director.ts");
    expect(buildRuntime).toContain("services/agentic/dist/finance-runtime.js");
  });

  it('loads that runtime only against an explicit finance database', () => {
    expect(workerConfig).toContain('FINANCE_DATABASE_URL:z.string().url().optional()');
    expect(worker).toContain('financeRuntime = await loadFinanceRuntime(');
    expect(worker).toContain("() => import('./finance-runtime.js')");
    expect(worker.indexOf('financeRuntime = await loadFinanceRuntime(')).toBeLessThan(worker.indexOf('healthServer.listen('));
  });

  it('wires the dashboard database into the production worker so the canonical runtime is not dormant', () => {
    expect(railway).toContain('FINANCE_DATABASE_URL: dashboardDatabase.env.DATABASE_URL');
    expect(railway).toContain("const repository = 'Santos123-Sys/Global-portfolio-intelligence'");
  });
});
