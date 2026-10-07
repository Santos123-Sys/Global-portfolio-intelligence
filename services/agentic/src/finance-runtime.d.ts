export function initializeFinanceRuntime(): Promise<void>;
export function processQueuedSessions(onHeartbeat?:()=>void): Promise<number>;
