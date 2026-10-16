import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db';
import { users, userSessions } from '../db/schema';
import { accountCanEdit, resolveAccountMembership } from '../account-scope';
import { SESSION_IDLE_SECONDS } from '../auth';
import { verifyHandoff } from './workspace-handoff';

/** No cookie/token digest is disclosed to FilingLens. The signed session id is not a login credential. */
export async function analysisAccessAllowed(ticket:string,operation:'analysis:run'|'valuation:publish'='analysis:run',now=new Date()):Promise<boolean> {
  let ctx;
  try{ctx=verifyHandoff(ticket,process.env.INTEGRATION_SIGNING_SECRET??'',Math.floor(now.getTime()/1000));}catch{return false;}
  if(!ctx.sessionId||ctx.audience!=='filinglens'||!ctx.permissions?.includes(operation))return false;
  const [session]=await db.select({userId:users.id,role:users.role})
    .from(userSessions).innerJoin(users,eq(userSessions.userId,users.id))
    .where(and(eq(userSessions.id,ctx.sessionId),eq(users.id,ctx.reviewerUserId),
      gt(userSessions.expiresAt,now),gt(userSessions.lastSeenAt,new Date(now.getTime()-SESSION_IDLE_SECONDS*1000)),
      isNull(userSessions.revokedAt),isNull(users.disabledAt))).limit(1);
  if(!session)return false;
  const membership=await resolveAccountMembership(session.userId,ctx.workspaceId,session.role==='platform_admin');
  // The membership resolver can fall back to another account; that never grants this ticket's scope.
  return membership?.accountId===ctx.workspaceId && accountCanEdit(membership.role);
}
