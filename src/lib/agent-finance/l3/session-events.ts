import { db } from '@/lib/db';
import { agentSessionEvents } from '@/lib/db/agent-schema';
import { sessionEventSchema, type SessionEvent } from '../contracts';

export async function recordSessionEvent(sessionId:string,event:Omit<SessionEvent,'occurredAt'>) {
  const parsed=sessionEventSchema.parse({...event,occurredAt:new Date().toISOString()});
  await db.insert(agentSessionEvents).values({...parsed,sessionId,occurredAt:new Date(parsed.occurredAt),reversible:parsed.reversible?1:0});
}
