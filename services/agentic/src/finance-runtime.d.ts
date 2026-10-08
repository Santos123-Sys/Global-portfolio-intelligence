export function initializeFinanceRuntime(): Promise<void>;
export function processQueuedSessions(onHeartbeat?:()=>void): Promise<number>;
export function getResearchQueueTelemetry(): Promise<{queued:number;running:number;oldestQueuedSeconds:number|null}>;
