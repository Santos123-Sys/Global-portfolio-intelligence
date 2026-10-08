export interface FinanceRuntime {
  initializeFinanceRuntime(): Promise<void>;
  processQueuedSessions(onHeartbeat?: () => void): Promise<number>;
  getResearchQueueTelemetry(): Promise<{
    queued: number;
    running: number;
    oldestQueuedSeconds: number | null;
  }>;
}

/** Await every readiness dependency; a detached import must never signal ready. */
export async function loadFinanceRuntime(
  databaseUrl: string | undefined,
  load: () => Promise<FinanceRuntime>,
  env: NodeJS.ProcessEnv = process.env
): Promise<FinanceRuntime | null> {
  if (!databaseUrl) return null;
  // Set this before import: the bundled runtime uses the dashboard database
  // contract, while the preparatory repository keeps AGENTIC_DATABASE_URL.
  env.DATABASE_URL = databaseUrl;
  const runtime = await load();
  await runtime.initializeFinanceRuntime();
  return runtime;
}
