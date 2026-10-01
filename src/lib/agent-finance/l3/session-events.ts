import { db } from '@/lib/db';
import { agentSessionEvents } from '@/lib/db/agent-schema';
import { sessionEventSchema, type SessionEvent } from '../contracts';

/** Keep operational errors useful without persisting credentials or signed query strings. */
export function sanitizeActivityDetail(value:string,maxLength=4000) {
  return value
    .replace(/(bearer\s+)[^\s]+/gi,'$1[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi,'$1[redacted]')
    .replace(/\b(?:sk|AIza)[A-Za-z0-9_-]{12,}\b/g,'[redacted credential]')
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/g,'$1?[redacted query]')
    .slice(0,maxLength);
}

export async function recordSessionEvent(sessionId:string,event:Omit<SessionEvent,'occurredAt'>) {
  const parsed=sessionEventSchema.parse({...event,detail:event.detail ? sanitizeActivityDetail(event.detail) : undefined,occurredAt:new Date().toISOString()});
  await db.insert(agentSessionEvents).values({...parsed,sessionId,occurredAt:new Date(parsed.occurredAt),reversible:parsed.reversible?1:0});
}
